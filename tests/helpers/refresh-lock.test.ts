// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withRefreshLock } from "../../src/helpers/refresh-lock";
import { restoreEnv, safeRmSync } from "../test-utils";

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

  test("holds the lock while the task runs and removes it afterwards", async () => {
    let heldDuringTask = false;
    const result = await withRefreshLock(async () => {
      heldDuringTask = existsSync(lockPath);
      return "done";
    }, lockPath);

    expect(result).toBe("done");
    expect(heldDuringTask).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  test("removes the lock when the task throws", async () => {
    const run = withRefreshLock(async () => {
      throw new Error("renewal failed");
    }, lockPath);

    expect(run).rejects.toThrow("renewal failed");
    await run.catch(() => {
      // Asserted above; awaited so the finally block has run.
    });
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

    expect(events).toHaveLength(4);
    expect(events[1]).toBe(events[0]?.replace("start", "end"));
    expect(events[3]).toBe(events[2]?.replace("start", "end"));
  });

  test("takes over a lock abandoned by a dead process", async () => {
    fs.mkdirSync(join(tempDir, "state"));
    writeFileSync(lockPath, "4242");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);

    let heldDuringTask = "";
    await withRefreshLock(
      async () => {
        heldDuringTask = fs.readFileSync(lockPath, "utf8");
      },
      lockPath,
      { staleMs: 1_000 }
    );

    expect(heldDuringTask).toBe(String(process.pid));
    expect(existsSync(lockPath)).toBe(false);
  });

  // A slow holder must not block the git operation indefinitely.
  test("runs without the lock once the wait runs out", async () => {
    fs.mkdirSync(join(tempDir, "state"));
    writeFileSync(lockPath, "4242");

    let ran = false;
    await withRefreshLock(
      async () => {
        ran = true;
      },
      lockPath,
      { waitMs: 20, pollMs: 5 }
    );

    expect(ran).toBe(true);
    // The other holder's lock is left alone.
    expect(fs.readFileSync(lockPath, "utf8")).toBe("4242");
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

  // A lock that cannot be deleted is waited on like a live one, so the loop
  // cannot spin.
  test("waits out a stale lock it cannot remove", async () => {
    fs.mkdirSync(join(tempDir, "state"));
    writeFileSync(lockPath, "4242");
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
    expect(existsSync(lockPath)).toBe(true);
  });

  test("retries at once when a stale lock vanishes before its removal", async () => {
    fs.mkdirSync(join(tempDir, "state"));
    writeFileSync(lockPath, "4242");
    const statSpy = spyOn(fs, "statSync").mockImplementationOnce(() => {
      fs.rmSync(lockPath);
      throw Object.assign(new Error("gone"), { code: "ENOENT" });
    });
    try {
      let heldDuringTask = false;
      await withRefreshLock(
        async () => {
          heldDuringTask = existsSync(lockPath);
        },
        lockPath,
        { waitMs: 1_000, pollMs: 5 }
      );
      expect(heldDuringTask).toBe(true);
    } finally {
      statSpy.mockRestore();
    }
  });

  // HOME is read by the path helper at call time, so overriding it is the
  // supported way to keep the default path inside the sandbox (ARCH-005).
  test("defaults to the lock file in the archgate state directory", async () => {
    const originalHome = Bun.env.HOME;
    Bun.env.HOME = tempDir;
    try {
      let heldDuringTask = false;
      await withRefreshLock(async () => {
        heldDuringTask = existsSync(join(tempDir, ".archgate", "refresh.lock"));
      });
      expect(heldDuringTask).toBe(true);
    } finally {
      restoreEnv("HOME", originalHome);
    }
  });
});
