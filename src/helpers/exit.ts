// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * exit.ts — Centralized process-exit helper for the CLI.
 *
 * Every command that needs a non-zero exit (and some that need zero) must go
 * through {@link exitWith} instead of calling `process.exit(code)` directly.
 * The helper records a `command_completed` telemetry event with the real exit
 * code + a high-level outcome tag, then flushes PostHog and Sentry before
 * exiting. Calling `process.exit` directly skips the Commander `postAction`
 * hook AND the `main()`-level flush, dropping the event on the floor — which
 * is exactly why `exit_code` used to be stuck at 0 in the dashboard.
 *
 * Lifecycle:
 *   1. Commander preAction hook calls {@link beginCommand} with the full
 *      command path so we know which command we're timing.
 *   2. The action runs. On the happy path it returns and Commander's
 *      `postAction` hook calls {@link finalizeCommand}`(cmd, 0, "success")`.
 *   3. On an expected failure, the action calls `await exitWith(1, ...)` which
 *      finalizes + flushes + exits.
 *   4. On an unexpected crash, `main().catch()` calls `await exitWith(2, ...)`.
 *
 * The module-level guard prevents double-counting when both `exitWith` and the
 * Commander `postAction` hook fire for the same invocation.
 */

import { flushSentry } from "./sentry";
import { flushTelemetry, trackCommandResult } from "./telemetry";

export type CommandOutcome =
  | "success"
  | "user_error"
  | "internal_error"
  | "cancelled";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentCommand: string | null = null;
let commandStartTime: number | null = null;
let completionTracked = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record the start of a command. Called from the Commander `preAction` hook
 * once per invocation, before the action runs.
 */
export function beginCommand(fullCommand: string): void {
  currentCommand = fullCommand;
  commandStartTime = performance.now();
  completionTracked = false;
}

/**
 * Emit the `command_completed` event. Safe to call multiple times — only the
 * first call records an event.
 */
export function finalizeCommand(
  fullCommand: string,
  exitCode: number,
  outcome: CommandOutcome,
  extra?: { errorKind?: string }
): void {
  if (completionTracked) return;
  completionTracked = true;

  const name = fullCommand || currentCommand || "unknown";
  const durationMs =
    commandStartTime === null
      ? 0
      : Math.round(performance.now() - commandStartTime);

  trackCommandResult(name, exitCode, durationMs, {
    outcome,
    error_kind: extra?.errorKind ?? null,
  });
}

/**
 * Terminate the process after recording + flushing telemetry.
 *
 * Use this instead of `process.exit(code)` anywhere inside a command action
 * or the top-level error boundary. Safe to `await` — the returned promise is
 * typed `Promise<never>` because control never returns.
 *
 * The outcome tag defaults to a sensible value derived from the exit code:
 *   - 0   → "success"
 *   - 1   → "user_error"
 *   - 2   → "internal_error"
 *   - 130 → "cancelled"
 * Override via the `outcome` option when the default doesn't fit.
 */
export async function exitWith(
  code: 0 | 1 | 2 | 130,
  opts?: { outcome?: CommandOutcome; errorKind?: string }
): Promise<never> {
  const outcome = opts?.outcome ?? defaultOutcome(code);
  const name = currentCommand ?? "root";

  try {
    finalizeCommand(name, code, outcome, { errorKind: opts?.errorKind });
  } catch {
    // Never let telemetry affect exit behavior
  }

  try {
    await Promise.all([flushTelemetry(), flushSentry()]);
  } catch {
    // Flush failures are best-effort
  }

  process.exit(code);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function defaultOutcome(code: number): CommandOutcome {
  switch (code) {
    case 0:
      return "success";
    case 130:
      return "cancelled";
    case 2:
      return "internal_error";
    default:
      return "user_error";
  }
}

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/** Reset internal state. For testing only. */
export function _resetExitState(): void {
  currentCommand = null;
  commandStartTime = null;
  completionTracked = false;
}

/** Inspect internal state. For testing only. */
export function _getExitState(): {
  currentCommand: string | null;
  commandStartTime: number | null;
  completionTracked: boolean;
} {
  return { currentCommand, commandStartTime, completionTracked };
}
