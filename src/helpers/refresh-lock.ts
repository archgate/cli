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
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
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
 * How long a guard file may exist before it counts as abandoned. Its holder
 * only reads, stats and unlinks one file with no `await` in between.
 */
const GUARD_STALE_MS = 5_000;

/** Attempts, and the pause between them, to take a busy guard on release. */
const RELEASE_GUARD_TRIES = 20;
const RELEASE_GUARD_PAUSE_MS = 5;

/** Create the guard carrying `token`; false when it exists or cannot be written. */
function createGuard(guard: string, token: string): boolean {
  let fd: number;
  try {
    fd = openSync(guard, "wx");
  } catch {
    return false;
  }
  try {
    writeSync(fd, token);
    return true;
  } catch {
    closeSync(fd);
    fd = -1;
    try {
      unlinkSync(guard);
    } catch {
      // Left for the stale check to reclaim.
    }
    return false;
  } finally {
    if (fd !== -1) closeSync(fd);
  }
}

/**
 * Remove an abandoned guard; true when it is gone. The guard is renamed first,
 * which only one process can do to a given file. If the renamed file turns
 * out to be fresh, another reclaimer replaced the stale one in between, so it
 * is linked back (`link` fails if a guard exists again) and this call yields.
 */
function reclaimGuard(guard: string): boolean {
  try {
    if (Date.now() - statSync(guard).mtimeMs < GUARD_STALE_MS) return false;
    const moved = `${guard}.${crypto.randomUUID()}`;
    renameSync(guard, moved);
    const fresh = Date.now() - statSync(moved).mtimeMs < GUARD_STALE_MS;
    if (fresh) {
      try {
        linkSync(moved, guard);
      } catch {
        // A newer guard already stands; the one moved here is lost.
      }
    }
    unlinkSync(moved);
    return !fresh;
  } catch {
    return false;
  }
}

/** Delete the guard only while it still carries `token`. */
function dropGuard(guard: string, token: string): void {
  try {
    if (readFileSync(guard, "utf8") === token) unlinkSync(guard);
  } catch {
    // Gone already; nothing left to release.
  }
}

/**
 * Run `action` while holding the guard file next to the lock. Release and
 * reclaim check the lock and then unlink it; the guard keeps either from
 * removing a lock that replaced the one it checked. Acquiring needs no guard,
 * since `wx` cannot create the lock while the checked file still exists.
 *
 * @returns `false` when the guard is held elsewhere and `action` did not run.
 */
function withGuard(path: string, action: () => void): boolean {
  const guard = `${path}.guard`;
  const token = crypto.randomUUID();
  const held =
    createGuard(guard, token) ||
    (reclaimGuard(guard) && createGuard(guard, token));
  if (!held) return false;
  try {
    action();
    return true;
  } finally {
    dropGuard(guard, token);
  }
}

/**
 * Try once to create the lock file, writing `token` into it.
 *
 * @returns `"acquired"` when this process now holds it, `"held"` when another
 * process does, or `"unavailable"` when the file cannot be created at all.
 */
function tryCreate(
  path: string,
  token: string
): "acquired" | "held" | "unavailable" {
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (error) {
    return errorCode(error) === "EEXIST" ? "held" : "unavailable";
  }
  try {
    writeSync(fd, token);
    return "acquired";
  } catch {
    // A lock nobody can identify as theirs would stall every waiter until it
    // turns stale, so it is removed straight away.
    release(path, null);
    return "unavailable";
  } finally {
    closeSync(fd);
  }
}

/** Remove a lock older than `staleMs`; true when the create should be retried at once. */
function removeIfStale(path: string, staleMs: number): boolean {
  let retry = false;
  const ran = withGuard(path, () => {
    try {
      if (Date.now() - statSync(path).mtimeMs < staleMs) return;
      unlinkSync(path);
      logDebug("removed an abandoned refresh lock");
      retry = true;
    } catch (error) {
      // Gone already: retry at once. A lock that cannot be checked or removed
      // is waited on like a live one, so the deadline still applies.
      retry = errorCode(error) === "ENOENT";
    }
  });
  return ran && retry;
}

/**
 * Delete the lock file if it still carries `token` (any file when `null`).
 * A lock another process now holds, or one whose token cannot be read, is
 * left alone; an unreleased lock turns stale.
 */
function release(path: string, token: string | null): void {
  const unlinkIfOurs = () => {
    try {
      if (token !== null && readFileSync(path, "utf8") !== token) return;
      unlinkSync(path);
    } catch {
      // Already gone, unreadable or held open by another program.
    }
  };
  for (let attempt = 0; attempt < RELEASE_GUARD_TRIES; attempt += 1) {
    if (withGuard(path, unlinkIfOurs)) return;
    Bun.sleepSync(RELEASE_GUARD_PAUSE_MS);
  }
  logDebug("refresh lock guard stayed busy; leaving the lock to turn stale");
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

  const token = `${process.pid}:${crypto.randomUUID()}`;
  const deadline = Date.now() + waitMs;
  let held = false;
  /* oxlint-disable no-await-in-loop -- polling one lock, attempts in order */
  for (;;) {
    const outcome = tryCreate(path, token);
    if (outcome === "acquired") {
      held = true;
      break;
    }
    if (outcome === "unavailable") {
      logDebug("refresh lock unavailable; renewing without it");
      break;
    }
    if (Date.now() >= deadline) {
      logDebug("refresh lock still held; renewing without it");
      break;
    }
    if (!removeIfStale(path, staleMs)) await Bun.sleep(pollMs);
  }
  /* oxlint-enable no-await-in-loop */

  try {
    return await task();
  } finally {
    if (held) release(path, token);
  }
}
