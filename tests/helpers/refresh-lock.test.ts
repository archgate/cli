// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withRefreshLock } from "../../src/helpers/refresh-lock";
import { rejectionMessage, restoreEnv, safeRmSync } from "../test-utils";

describe("withRefreshLock", () => {
  let tempDir: string;
  let lockPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-refresh-lock-"));
    lockPath = join(tempDir, "state", "refresh.lock");
  });

  afterEach(() => {
    safeRmSync(tempDir);
  });

  /** A lock file left by another process, optionally backdated. */
  function foreignLock(ageMs = 0): void {
    mkdirSync(join(tempDir, "state"), { recursive: true });
    writeFileSync(lockPath, "4242:other");
    if (ageMs > 0) {
      const then = new Date(Date.now() - ageMs);
      utimesSync(lockPath, then, then);
    }
  }

  test("holds the lock while the task runs and removes it afterwards", async () => {
    const result = await withRefreshLock(async () => {
      expect(existsSync(lockPath)).toBe(true);
      return "done";
    }, lockPath);

    expect(result).toBe("done");
    expect(existsSync(lockPath)).toBe(false);
  });

  test("writes a token naming this process", async () => {
    await withRefreshLock(async () => {
      expect(readFileSync(lockPath, "utf8")).toStartWith(`${process.pid}:`);
    }, lockPath);
  });

  test("removes the lock when the task throws", async () => {
    expect(
      await rejectionMessage(
        withRefreshLock(async () => {
          throw new Error("renewal failed");
        }, lockPath)
      )
    ).toBe("renewal failed");
    expect(existsSync(lockPath)).toBe(false);
  });

  test("runs concurrent tasks one at a time", async () => {
    const events: string[] = [];
    const task = (name: string) => async () => {
      events.push(`${name}:start`);
      await Bun.sleep(30);
      events.push(`${name}:end`);
    };

    await Promise.all([
      withRefreshLock(task("a"), lockPath, { pollMs: 5 }),
      withRefreshLock(task("b"), lockPath, { pollMs: 5 }),
    ]);

    const [first] = events;
    const second = first === "a:start" ? "b" : "a";
    expect(events).toEqual([
      first,
      first.replace("start", "end"),
      `${second}:start`,
      `${second}:end`,
    ]);
  });

  test("takes over a lock abandoned by a dead process", async () => {
    foreignLock(60_000);

    await withRefreshLock(
      async () => {
        expect(readFileSync(lockPath, "utf8")).toStartWith(`${process.pid}:`);
      },
      lockPath,
      { staleMs: 1_000 }
    );

    expect(existsSync(lockPath)).toBe(false);
  });

  // A holder that outlives the stale window must not delete a waiter's lock.
  test("leaves a lock that carries another process's token", async () => {
    await withRefreshLock(async () => {
      writeFileSync(lockPath, "4242:taker");
    }, lockPath);

    expect(readFileSync(lockPath, "utf8")).toBe("4242:taker");
  });

  test("finishes cleanly when its lock was removed under it", async () => {
    await withRefreshLock(async () => {
      fs.rmSync(lockPath);
    }, lockPath);

    expect(existsSync(lockPath)).toBe(false);
  });

  // A slow holder must not block the git operation indefinitely.
  test("runs without the lock once the wait runs out", async () => {
    foreignLock();

    let ran = false;
    await withRefreshLock(
      async () => {
        ran = true;
      },
      lockPath,
      { waitMs: 20, pollMs: 5 }
    );

    expect(ran).toBe(true);
    expect(readFileSync(lockPath, "utf8")).toBe("4242:other");
  });

  test("runs without the lock when the lock directory cannot be created", async () => {
    const blocker = join(tempDir, "not-a-dir");
    writeFileSync(blocker, "");

    let ran = false;
    await withRefreshLock(
      async () => {
        ran = true;
      },
      join(blocker, "refresh.lock")
    );

    expect(ran).toBe(true);
  });

  // A lock nobody can identify would stall every waiter until it turned stale.
  test("removes a lock file it created but could not write", async () => {
    const writeSpy = spyOn(fs, "writeSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    });
    try {
      let ran = false;
      await withRefreshLock(async () => {
        ran = true;
        expect(existsSync(lockPath)).toBe(false);
      }, lockPath);
      expect(ran).toBe(true);
    } finally {
      writeSpy.mockRestore();
    }
  });

  // A lock that cannot be deleted is waited on like a live one, so the loop
  // cannot spin.
  test("waits out a stale lock it cannot remove", async () => {
    foreignLock();
    const unlinkSpy = spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    });
    try {
      let ran = false;
      await withRefreshLock(
        async () => {
          ran = true;
        },
        lockPath,
        { waitMs: 20, pollMs: 5, staleMs: 0 }
      );
      expect(ran).toBe(true);
    } finally {
      unlinkSpy.mockRestore();
    }
    expect(readFileSync(lockPath, "utf8")).toBe("4242:other");
  });

  test("retries at once when a stale lock vanishes before its removal", async () => {
    foreignLock();
    const statSpy = spyOn(fs, "statSync").mockImplementationOnce(() => {
      fs.rmSync(lockPath);
      throw Object.assign(new Error("gone"), { code: "ENOENT" });
    });
    try {
      await withRefreshLock(
        async () => {
          expect(readFileSync(lockPath, "utf8")).toStartWith(`${process.pid}:`);
        },
        lockPath,
        { waitMs: 1_000, pollMs: 5 }
      );
    } finally {
      statSpy.mockRestore();
    }
  });

  /** A guard file left by another process, optionally backdated. */
  function foreignGuard(ageMs = 0): void {
    mkdirSync(join(tempDir, "state"), { recursive: true });
    const guardPath = `${lockPath}.guard`;
    writeFileSync(guardPath, "");
    if (ageMs > 0) {
      const then = new Date(Date.now() - ageMs);
      utimesSync(guardPath, then, then);
    }
  }

  // Another process is mid-check on the same stale lock, so this one waits
  // instead of removing a file whose ownership may be changing.
  test("does not reclaim a stale lock while another process holds the guard", async () => {
    foreignLock(60_000);
    foreignGuard();

    let ran = false;
    await withRefreshLock(
      async () => {
        ran = true;
      },
      lockPath,
      { staleMs: 1_000, waitMs: 20, pollMs: 5 }
    );

    expect(ran).toBe(true);
    expect(readFileSync(lockPath, "utf8")).toBe("4242:other");
  });

  test("takes over a guard abandoned by a dead process", async () => {
    foreignLock(60_000);
    foreignGuard(60_000);

    await withRefreshLock(
      async () => {
        expect(readFileSync(lockPath, "utf8")).toStartWith(`${process.pid}:`);
      },
      lockPath,
      { staleMs: 1_000, pollMs: 5 }
    );

    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(`${lockPath}.guard`)).toBe(false);
  });

  test("waits when an abandoned guard cannot be removed", async () => {
    foreignLock(60_000);
    // A directory in the guard's place: `wx` reports it as existing, and it
    // cannot be unlinked as a file.
    const guardPath = `${lockPath}.guard`;
    mkdirSync(guardPath);
    const then = new Date(Date.now() - 60_000);
    utimesSync(guardPath, then, then);

    let ran = false;
    await withRefreshLock(
      async () => {
        ran = true;
      },
      lockPath,
      { staleMs: 1_000, waitMs: 20, pollMs: 5 }
    );

    expect(ran).toBe(true);
    expect(readFileSync(lockPath, "utf8")).toBe("4242:other");
  });

  // A release that never gets the guard leaves its lock to turn stale rather
  // than unlinking without the check.
  test("leaves its lock in place when the guard stays busy", async () => {
    await withRefreshLock(async () => {
      foreignGuard();
    }, lockPath);

    expect(readFileSync(lockPath, "utf8")).toStartWith(`${process.pid}:`);
  });

  // HOME is read by the path helper at call time, so overriding it is the
  // supported way to keep the default path inside the sandbox (ARCH-005).
  test("defaults to the lock file in the archgate state directory", async () => {
    const originalHome = Bun.env.HOME;
    Bun.env.HOME = tempDir;
    try {
      await withRefreshLock(async () => {
        expect(existsSync(join(tempDir, ".archgate", "refresh.lock"))).toBe(
          true
        );
      });
    } finally {
      restoreEnv("HOME", originalHome);
    }
  });
});
