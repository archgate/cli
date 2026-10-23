// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Cross-process lock around session renewal. Parallel credential-helper runs
 * would otherwise exchange the same refresh token, and the platform revokes
 * the whole grant on a replayed one. Each caller files a uniquely named entry
 * in a directory, and the oldest live entry holds the lock once no caller is
 * still choosing its place (the bakery algorithm).
 */

import {
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { logDebug } from "./log";
import { internalPath } from "./paths";

/** Timings, injectable so tests do not wait in real time. */
export interface LockTimings {
  /** How long a waiter tries before running without the lock. */
  waitMs: number;
  /** Delay between attempts while another process holds the lock. */
  pollMs: number;
  /**
   * Age past which an entry counts as abandoned. It exceeds the longest a
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

/** Width of the zero-padded millisecond timestamp that starts each entry name. */
const STAMP_WIDTH = 15;

/** Entry names: a sortable creation time, then a UUID so no name repeats. */
const ENTRY_PATTERN = /^\d{15}-[0-9a-f-]{36}$/u;

/** Marker a caller holds while it picks its timestamp and files its entry. */
const MARKER_PREFIX = "pending-";
const MARKER_PATTERN = /^pending-[0-9a-f-]{36}$/u;

/** Where the entries live: next to the rest of the CLI's per-user state. */
function refreshLockDir(): string {
  return internalPath("refresh-lock");
}

/** Delete one entry; a missing file is fine. */
function removeEntry(dir: string, name: string): void {
  try {
    unlinkSync(join(dir, name));
  } catch {
    // Already gone.
  }
}

/**
 * Mark a waiting entry as alive, so the age check only ever catches entries
 * whose process stopped polling. False when the entry is gone.
 */
function touchEntry(dir: string, name: string): boolean {
  const now = new Date();
  try {
    utimesSync(join(dir, name), now, now);
    return true;
  } catch {
    return false;
  }
}

/**
 * File this caller's entry. The marker exists before the timestamp is taken,
 * so a caller that has read its timestamp but not yet filed is never
 * invisible: anyone deciding meanwhile sees the marker and waits.
 *
 * @returns The entry name and its timestamp, or `null` when nothing could be filed.
 */
function fileEntry(dir: string): { own: string; createdAt: number } | null {
  const id = crypto.randomUUID();
  const marker = `${MARKER_PREFIX}${id}`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, marker), String(process.pid), { flag: "wx" });
  } catch {
    return null;
  }
  try {
    const createdAt = Date.now();
    const own = `${String(createdAt).padStart(STAMP_WIDTH, "0")}-${id}`;
    writeFileSync(join(dir, own), String(process.pid), { flag: "wx" });
    return { own, createdAt };
  } catch {
    return null;
  } finally {
    removeEntry(dir, marker);
  }
}

/**
 * Whether `own` is the oldest live entry and no other caller is still filing.
 * Entries and markers older than `staleMs` are removed on the way: names never
 * repeat, so deleting one can only ever remove the abandoned file itself.
 *
 * @returns `null` when the directory cannot be read.
 */
function holdsLock(dir: string, own: string, staleMs: number): boolean | null {
  let names: string[];
  try {
    names = readdirSync(dir).filter(
      (name) => ENTRY_PATTERN.test(name) || MARKER_PATTERN.test(name)
    );
  } catch {
    return null;
  }
  const live: string[] = [];
  for (const name of names) {
    let age: number;
    try {
      age = Date.now() - statSync(join(dir, name)).mtimeMs;
    } catch {
      // A vanished marker usually means its entry was just filed, after this
      // listing was taken; only a fresh listing can show it.
      if (MARKER_PATTERN.test(name)) return false;
      continue;
    }
    if (name !== own && age >= staleMs) {
      removeEntry(dir, name);
      logDebug("removed an abandoned refresh lock entry");
    } else {
      live.push(name);
    }
  }
  if (live.some((name) => MARKER_PATTERN.test(name))) return false;
  return live.toSorted()[0] === own;
}

/**
 * Run `task` while holding the refresh lock.
 *
 * When the lock cannot be had — the directory is not writable, or the holder
 * outlasts `waitMs` — `task` runs anyway: a renewal that might race is better
 * than failing the git operation that needs the token.
 *
 * @param task - The work to serialize; it should re-read shared state first.
 * @param dir - Entry directory; defaults to {@link refreshLockDir}.
 * @param timings - Overrides for {@link DEFAULT_TIMINGS}.
 */
export async function withRefreshLock<T>(
  task: () => Promise<T>,
  dir: string = refreshLockDir(),
  timings: Partial<LockTimings> = {}
): Promise<T> {
  const { waitMs, pollMs, staleMs } = { ...DEFAULT_TIMINGS, ...timings };
  const entry = fileEntry(dir);
  let filed = entry !== null;
  if (!filed) logDebug("refresh lock unavailable; renewing without it");
  const own = entry?.own ?? "";
  const createdAt = entry?.createdAt ?? 0;

  // Deciding only after the clock passes this entry's timestamp makes every
  // caller who marks itself later take a strictly later timestamp, so it
  // sorts after this entry; anyone who marked itself earlier is listed.
  /* oxlint-disable no-await-in-loop -- one wait, then polling in order */
  while (filed && Date.now() <= createdAt) await Bun.sleep(1);
  const deadline = Date.now() + waitMs;
  while (filed) {
    const holds = holdsLock(dir, own, staleMs);
    if (holds === true) break;
    if (holds === null || Date.now() >= deadline || !touchEntry(dir, own)) {
      // Withdrawn so that waiters behind it do not wait on it.
      removeEntry(dir, own);
      filed = false;
      logDebug("refresh lock not acquired; renewing without it");
      break;
    }
    await Bun.sleep(pollMs);
  }
  /* oxlint-enable no-await-in-loop */

  try {
    return await task();
  } finally {
    if (filed) removeEntry(dir, own);
  }
}
