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
  readFileSync,
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

/** The holder's token stored in the lock file, or `null` when unreadable. */
function readToken(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
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
  try {
    const token = readToken(path);
    if (Date.now() - statSync(path).mtimeMs < staleMs) return false;
    // Another waiter may have taken the lock over since the read; only the
    // abandoned holder's file is removed.
    if (readToken(path) !== token) return true;
    unlinkSync(path);
    logDebug("removed an abandoned refresh lock");
    return true;
  } catch (error) {
    // Gone already: retry at once. A lock that cannot be removed is waited
    // on like a live one, so the deadline still applies.
    return errorCode(error) === "ENOENT";
  }
}

/**
 * Delete the lock file if it still carries `token` (any file when `null`).
 * A waiter that took the lock over as stale owns it now, so it is left alone.
 */
function release(path: string, token: string | null): void {
  if (token !== null && readToken(path) !== token) return;
  try {
    unlinkSync(path);
  } catch {
    // Already gone, or held open by another program; it turns stale either way.
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
