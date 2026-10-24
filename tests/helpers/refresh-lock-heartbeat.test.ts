// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withRefreshLock } from "../../src/helpers/refresh-lock";
import { safeRmSync } from "../test-utils";

/** The name a live holder that sorts before any new caller would file. */
const HOLDER = `${String(1).padStart(15, "0")}-00000000-0000-4000-8000-000000000000`;

// A waiter refreshes its entry while it polls, because other callers remove
// entries left untouched for `staleMs`.
describe("withRefreshLock heartbeat", () => {
  let tempDir: string;
  let lockDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-refresh-heartbeat-"));
    lockDir = join(tempDir, "refresh-lock");
  });

  afterEach(() => {
    safeRmSync(tempDir);
  });

  /** A live entry filed by another process that holds the lock. */
  function holderEntry(): string {
    mkdirSync(lockDir, { recursive: true });
    const path = join(lockDir, HOLDER);
    writeFileSync(path, "4242");
    return path;
  }

  // Others reap entries untouched for `staleMs`, so a waiter whose refreshes
  // keep failing withdraws before it can be mistaken for dead.
  test("withdraws once its refreshes have failed for half the stale window", async () => {
    holderEntry();
    const touchSpy = spyOn(fs, "utimesSync").mockImplementation(() => {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    });
    try {
      const started = Date.now();
      let ran = false;
      await withRefreshLock(
        async () => {
          ran = true;
          expect(readdirSync(lockDir)).toEqual([HOLDER]);
        },
        lockDir,
        { staleMs: 60, waitMs: 5_000, pollMs: 5 }
      );
      expect(ran).toBe(true);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      touchSpy.mockRestore();
    }
  });

  // A poll interval longer than the stale window must not let a waiter sleep
  // past the point where others would reap it.
  test("withdraws on time when polls are slower than the stale window", async () => {
    holderEntry();
    const touchSpy = spyOn(fs, "utimesSync").mockImplementation(() => {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    });
    try {
      const started = Date.now();
      await withRefreshLock(async () => {}, lockDir, {
        staleMs: 60,
        pollMs: 1_000,
        waitMs: 5_000,
      });
      expect(Date.now() - started).toBeLessThan(500);
    } finally {
      touchSpy.mockRestore();
    }
  });

  test("refreshes often enough to stay live when polls are slower than the stale window", async () => {
    const holder = holderEntry();
    const touched: number[] = [];
    const realTouch = fs.utimesSync;
    const touchSpy = spyOn(fs, "utimesSync").mockImplementation((...args) => {
      touched.push(Date.now());
      realTouch(...args);
    });
    setTimeout(() => {
      fs.rmSync(holder, { force: true });
    }, 500);
    try {
      const started = Date.now();
      await withRefreshLock(
        async () => {
          // It acquired the lock once the holder finished, rather than
          // withdrawing and running while the holder's entry still stood.
          expect(existsSync(holder)).toBe(false);
          expect(readdirSync(lockDir)).toHaveLength(1);
        },
        lockDir,
        { staleMs: 400, pollMs: 1_000, waitMs: 5_000 }
      );
      expect(Date.now() - started).toBeLessThan(900);
      // Several refreshes, so the gap check below compares real intervals.
      expect(touched.length).toBeGreaterThanOrEqual(3);
      const gaps = touched.slice(1).map((at, i) => at - (touched[i] ?? at));
      expect(gaps.filter((gap) => gap >= 400)).toEqual([]);
    } finally {
      touchSpy.mockRestore();
    }
  });

  // Timers can fire late. A healthy waiter must still refresh before its
  // withdrawal point rather than give up.
  test("stays in line when its timers fire late", async () => {
    const holder = holderEntry();
    const realSleep = Bun.sleep;
    const sleepSpy = spyOn(Bun, "sleep").mockImplementation(async (ms) =>
      realSleep(Number(ms) + 50)
    );
    setTimeout(() => {
      fs.rmSync(holder, { force: true });
    }, 500);
    try {
      await withRefreshLock(
        async () => {
          // It acquired the lock once the holder finished, rather than
          // withdrawing and running while the holder's entry still stood.
          expect(existsSync(holder)).toBe(false);
          expect(readdirSync(lockDir)).toHaveLength(1);
        },
        lockDir,
        { staleMs: 400, pollMs: 1_000, waitMs: 5_000 }
      );
    } finally {
      sleepSpy.mockRestore();
    }
  });

  test("keeps waiting through a refresh failure that recovers", async () => {
    const holder = holderEntry();
    let touches = 0;
    const realTouch = fs.utimesSync;
    const touchSpy = spyOn(fs, "utimesSync").mockImplementation((...args) => {
      touches += 1;
      if (touches === 1) {
        throw Object.assign(new Error("busy"), { code: "EBUSY" });
      }
      // The holder finishes once this waiter has refreshed successfully.
      fs.rmSync(holder, { force: true });
      realTouch(...args);
    });
    try {
      await withRefreshLock(
        async () => {
          // Still filed: it ran holding the lock, not after withdrawing.
          expect(readdirSync(lockDir)).toHaveLength(1);
          expect(existsSync(holder)).toBe(false);
        },
        lockDir,
        { staleMs: 10_000, waitMs: 5_000, pollMs: 5 }
      );
      expect(touches).toBeGreaterThan(1);
    } finally {
      touchSpy.mockRestore();
    }
  });
});
