// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withRefreshLock } from "../../src/helpers/refresh-lock";
import { rejectionMessage, restoreEnv, safeRmSync } from "../test-utils";

/** An entry name for `stamp`, with a UUID that sorts first or last. */
function entryName(stamp: number, uuid: "low" | "high"): string {
  const id =
    uuid === "low"
      ? "00000000-0000-4000-8000-000000000000"
      : "ffffffff-ffff-4fff-bfff-ffffffffffff";
  return `${String(stamp).padStart(15, "0")}-${id}`;
}

describe("withRefreshLock", () => {
  let tempDir: string;
  let lockDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-refresh-lock-"));
    lockDir = join(tempDir, "refresh-lock");
  });

  afterEach(() => {
    safeRmSync(tempDir);
  });

  /** An entry filed by another process, optionally backdated. */
  function foreignEntry(name: string, ageMs = 0): string {
    mkdirSync(lockDir, { recursive: true });
    const path = join(lockDir, name);
    writeFileSync(path, "4242");
    if (ageMs > 0) {
      const then = new Date(Date.now() - ageMs);
      utimesSync(path, then, then);
    }
    return path;
  }

  test("files an entry while the task runs and removes it afterwards", async () => {
    const result = await withRefreshLock(async () => {
      const names = readdirSync(lockDir);
      expect(names).toHaveLength(1);
      expect(readFileSync(join(lockDir, names[0] ?? ""), "utf8")).toBe(
        String(process.pid)
      );
      return "done";
    }, lockDir);

    expect(result).toBe("done");
    expect(readdirSync(lockDir)).toEqual([]);
  });

  test("removes its entry when the task throws", async () => {
    expect(
      await rejectionMessage(
        withRefreshLock(async () => {
          throw new Error("renewal failed");
        }, lockDir)
      )
    ).toBe("renewal failed");
    expect(readdirSync(lockDir)).toEqual([]);
  });

  // The property the lock exists for: renewals never overlap, even when
  // several start at once and an abandoned entry has to be cleared first.
  test("never runs two tasks at once", async () => {
    foreignEntry(entryName(1, "low"), 60_000);
    let active = 0;
    let peak = 0;
    let finished = 0;
    const task = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Bun.sleep(10);
      active -= 1;
      finished += 1;
    };

    await Promise.all(
      Array.from({ length: 6 }, async () =>
        withRefreshLock(task, lockDir, { pollMs: 2, staleMs: 1_000 })
      )
    );

    expect(finished).toBe(6);
    expect(peak).toBe(1);
    expect(readdirSync(lockDir)).toEqual([]);
  });

  test("removes an entry abandoned by a dead process", async () => {
    const abandoned = foreignEntry(entryName(1, "low"), 60_000);

    await withRefreshLock(
      async () => {
        expect(existsSync(abandoned)).toBe(false);
      },
      lockDir,
      { staleMs: 1_000 }
    );
  });

  // A slow holder must not block the git operation indefinitely.
  test("runs without the lock once the wait for a live holder runs out", async () => {
    const holder = foreignEntry(entryName(1, "low"));

    let ran = false;
    await withRefreshLock(
      async () => {
        ran = true;
        // Withdrawn before running, so it does not hold up later waiters.
        expect(readdirSync(lockDir)).toEqual([entryName(1, "low")]);
      },
      lockDir,
      { waitMs: 20, pollMs: 5 }
    );

    expect(ran).toBe(true);
    expect(existsSync(holder)).toBe(true);
  });

  test("is not held up by an entry filed after its own", async () => {
    foreignEntry(entryName(Date.now() + 60_000, "low"));

    let entries = 0;
    await withRefreshLock(
      async () => {
        entries = readdirSync(lockDir).length;
      },
      lockDir,
      { waitMs: 1_000 }
    );

    expect(entries).toBe(2);
  });

  // Two callers can file in the same millisecond, and the later one can sort
  // first. The decision waits for the clock to move on, so the earlier one
  // sees the later entry and yields instead of running alongside it.
  test("yields to an entry filed in the same millisecond that sorts first", async () => {
    const realNow = Date.now.bind(Date);
    const stamp = realNow();
    let calls = 0;
    const nowSpy = spyOn(Date, "now").mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        foreignEntry(entryName(stamp, "low"));
        return stamp;
      }
      return calls === 2 ? stamp : realNow();
    });
    try {
      await withRefreshLock(
        async () => {
          expect(readdirSync(lockDir)).toEqual([entryName(stamp, "low")]);
        },
        lockDir,
        { waitMs: 20, pollMs: 5 }
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  test("ignores files that are not entries", async () => {
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "notes.txt"), "");

    let entries: string[] = [];
    await withRefreshLock(async () => {
      entries = readdirSync(lockDir);
    }, lockDir);

    expect(entries).toHaveLength(2);
    expect(readdirSync(lockDir)).toEqual(["notes.txt"]);
  });

  test("runs without the lock when the directory cannot be created", async () => {
    const blocker = join(tempDir, "not-a-dir");
    writeFileSync(blocker, "");

    let ran = false;
    await withRefreshLock(
      async () => {
        ran = true;
      },
      join(blocker, "refresh-lock")
    );

    expect(ran).toBe(true);
  });

  test("withdraws and runs without the lock when the directory cannot be read", async () => {
    const readSpy = spyOn(fs, "readdirSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    });
    try {
      let ran = false;
      await withRefreshLock(async () => {
        ran = true;
      }, lockDir);
      expect(ran).toBe(true);
    } finally {
      readSpy.mockRestore();
    }
    expect(readdirSync(lockDir)).toEqual([]);
  });

  test("skips an entry that vanishes while it is checked", async () => {
    foreignEntry(entryName(1, "low"));
    const statSpy = spyOn(fs, "statSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("gone"), { code: "ENOENT" });
    });
    try {
      let ran = false;
      await withRefreshLock(
        async () => {
          ran = true;
        },
        lockDir,
        { waitMs: 1_000, pollMs: 5 }
      );
      expect(ran).toBe(true);
    } finally {
      statSpy.mockRestore();
    }
  });

  // A waiter without an entry is not in line, so it stops waiting rather
  // than polling for a turn that cannot come.
  test("stops waiting when its own entry disappears", async () => {
    const holderName = entryName(1, "low");
    foreignEntry(holderName);
    const original = fs.readdirSync;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one overload is all the code under test uses
    const readSpy = spyOn(fs, "readdirSync").mockImplementationOnce(((
      ...args: Parameters<typeof fs.readdirSync>
    ) => {
      for (const name of original(lockDir)) {
        if (name !== holderName) fs.rmSync(join(lockDir, name));
      }
      return original(...args);
    }) as typeof fs.readdirSync);
    try {
      let ran = false;
      await withRefreshLock(
        async () => {
          ran = true;
        },
        lockDir,
        { waitMs: 60_000, pollMs: 5 }
      );
      expect(ran).toBe(true);
    } finally {
      readSpy.mockRestore();
    }
  });

  // HOME is read by the path helper at call time, so overriding it is the
  // supported way to keep the default path inside the sandbox (ARCH-005).
  test("defaults to the archgate state directory", async () => {
    const originalHome = Bun.env.HOME;
    Bun.env.HOME = tempDir;
    try {
      await withRefreshLock(async () => {
        expect(
          readdirSync(join(tempDir, ".archgate", "refresh-lock"))
        ).toHaveLength(1);
      });
    } finally {
      restoreEnv("HOME", originalHome);
    }
  });
});
