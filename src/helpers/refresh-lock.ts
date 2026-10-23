// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Cross-process lock around session renewal. Parallel credential-helper runs
 * would otherwise exchange the same refresh token, and the platform revokes
 * the whole grant on a replayed one. An `O_EXCL` file is the lock; one older
 * than {@link LockTimings.staleMs} is treated as abandoned.
 */

import {
  closeSync,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

import { logDebug } from "./log";
import { internalPath } from "./paths";

/** Timings, injectable so tests do not wait in real time. */
export interface LockTimings {
  /** How long a waiter tries before running without the lock. */
  waitMs: number;
  /** Delay between attempts while another process holds the lock. */
  pollMs: number;
  /**
   * Age past which a lock counts as abandoned. It exceeds the longest a
   * holder can need: the token request's 15 s timeout plus the store write
   * and its read-back.
   */
  staleMs: number;
}

const DEFAULT_TIMINGS: LockTimings = {
  waitMs: 40_000,
  pollMs: 100,
  staleMs: 30_000,
};

/** Where the lock lives: next to the rest of the CLI's per-user state. */
function refreshLockPath(): string {
  return internalPath("refresh.lock");
}

/** The `code` of a Node file-system error, or `undefined` for anything else. */
function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

/**
 * Try once to create the lock file.
 *
 * @returns `"acquired"` when this process now holds it, `"held"` when another
 * process does, or `"unavailable"` when the file cannot be created at all.
 */
function tryCreate(path: string): "acquired" | "held" | "unavailable" {
  try {
    const fd = openSync(path, "wx");
    try {
      writeSync(fd, String(process.pid));
    } finally {
      closeSync(fd);
    }
    return "acquired";
  } catch (error) {
    return errorCode(error) === "EEXIST" ? "held" : "unavailable";
  }
}

/** Remove a lock older than `staleMs`; true when the create should be retried at once. */
function removeIfStale(path: string, staleMs: number): boolean {
  try {
    if (Date.now() - statSync(path).mtimeMs < staleMs) return false;
    unlinkSync(path);
    logDebug("removed an abandoned refresh lock");
    return true;
  } catch (error) {
    // Gone already: retry at once. A lock that cannot be removed is waited
    // on like a live one, so the deadline still applies.
    return errorCode(error) === "ENOENT";
  }
}

/** Delete the lock this process holds; a missing file is fine. */
function release(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Taken over as stale by a waiter; nothing left to release.
  }
}

/**
 * Run `task` while holding the refresh lock.
 *
 * When the lock cannot be had — the directory is not writable, or the holder
 * outlasts `waitMs` — `task` runs anyway: a renewal that might race is better
 * than failing the git operation that needs the token.
 *
 * @param task - The work to serialize; it should re-read shared state first.
 * @param path - Lock file; defaults to {@link refreshLockPath}.
 * @param timings - Overrides for {@link DEFAULT_TIMINGS}.
 */
export async function withRefreshLock<T>(
  task: () => Promise<T>,
  path: string = refreshLockPath(),
  timings: Partial<LockTimings> = {}
): Promise<T> {
  const { waitMs, pollMs, staleMs } = { ...DEFAULT_TIMINGS, ...timings };
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    // tryCreate reports the directory as unavailable below.
  }

  const deadline = Date.now() + waitMs;
  let held = false;
  /* oxlint-disable no-await-in-loop -- polling one lock, attempts in order */
  while (!held) {
    const outcome = tryCreate(path);
    if (outcome === "acquired") {
      held = true;
    } else if (outcome === "unavailable") {
      logDebug("refresh lock unavailable; renewing without it");
      break;
    } else if (!removeIfStale(path, staleMs)) {
      if (Date.now() >= deadline) {
        logDebug("refresh lock still held; renewing without it");
        break;
      }
      await Bun.sleep(pollMs);
    }
  }
  /* oxlint-enable no-await-in-loop */

  try {
    return await task();
  } finally {
    if (held) release(path);
  }
}
