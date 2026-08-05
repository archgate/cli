// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Broken-pipe guards for `process.stdout`/`process.stderr`. When a piped
 * reader closes early (`archgate adr list | head`, an agent harness tearing
 * down), the next write emits an EPIPE `error` event — fatal without a
 * listener. A closed stdout means "consumer is done" (quiet exit 0), a
 * broken stderr is non-fatal, and every other stream error crashes loudly.
 */

import { exitForBrokenPipe, isEpipeError } from "./exit";

// ---------------------------------------------------------------------------
// Exit action (replaceable in tests)
// ---------------------------------------------------------------------------

function defaultBrokenPipeExit(): void {
  // exitForBrokenPipe flushes telemetry over the network before exiting —
  // safe with a dead stdout, since nothing is written to the streams.
  void exitForBrokenPipe();
}

let brokenPipeExit: () => void = defaultBrokenPipeExit;
let exiting = false;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * `error` listener for stdout. EPIPE means the consumer of the CLI's
 * primary output is gone, so nothing further can be delivered: exit 0 (the
 * pipeline convention). The `exiting` guard prevents double-firing while
 * the async exit path (telemetry flush) is still in flight — Bun re-emits
 * EPIPE on every subsequent write.
 *
 * @param err - The emitted stream error.
 * @throws Non-EPIPE errors, so they escalate to an uncaught exception
 * exactly as they would without the listener.
 */
export function handleStdoutError(err: unknown): void {
  if (!isEpipeError(err)) throw err;
  if (exiting) return;
  exiting = true;
  brokenPipeExit();
}

/**
 * `error` listener for stderr. EPIPE is swallowed instead of exiting:
 * diagnostics are best-effort, and the primary output channel (stdout) may
 * still have a live consumer.
 *
 * @param err - The emitted stream error.
 * @throws Non-EPIPE errors, preserving the loud-crash default.
 */
export function handleStderrError(err: unknown): void {
  if (!isEpipeError(err)) throw err;
}

/**
 * Attach both guards. Call once at CLI startup, before any output.
 */
export function installStreamErrorGuards(): void {
  process.stdout.on("error", handleStdoutError);
  process.stderr.on("error", handleStderrError);
}

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/**
 * Replace the broken-pipe exit action and reset the re-entrancy guard.
 * Pass `null` to restore the default. For testing only.
 */
export function _setBrokenPipeExit(fn: (() => void) | null): void {
  brokenPipeExit = fn ?? defaultBrokenPipeExit;
  exiting = false;
}
