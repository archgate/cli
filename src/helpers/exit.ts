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

import { logError } from "./log";
import { captureException, flushSentry } from "./sentry";
import { flushTelemetry, trackCommandResult } from "./telemetry";
import { UserError } from "./user-error";

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

/**
 * Centralized error handler for command catch blocks.
 *
 * Every async command action's catch block should delegate here instead of
 * inlining `logError + exitWith`.  The handler:
 *
 *   1. Re-throws `ExitPromptError` so `main().catch()` handles Ctrl+C (exit 130)
 *   2. Captures **unexpected** errors (non-{@link UserError}) to Sentry
 *   3. Logs the error message via `logError()`
 *   4. Exits with code 1
 *
 * Expected user-facing errors (validation, network, auth) should be thrown as
 * {@link UserError} in helpers — these are logged but not sent to Sentry.
 */
export function handleCommandError(err: unknown): Promise<never> {
  if (err instanceof Error && err.name === "ExitPromptError") throw err;

  // Only capture unexpected errors to Sentry — UserError is expected
  if (!(err instanceof UserError)) {
    captureException(err, {
      command: currentCommand ?? "unknown",
      errorKind: classifyErrorKind(err),
    });
  }

  logError(err instanceof Error ? err.message : String(err));
  return exitWith(1, { errorKind: classifyErrorKind(err) });
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Classify an error into a high-level bucket for telemetry.
 * Returns a short tag — never the raw error message.
 */
export function classifyErrorKind(err: unknown): string {
  if (!(err instanceof Error)) return "unknown";
  const name = err.name || "Error";
  const msg = err.message || "";
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/iu.test(msg))
    return "network";
  if (/certificate|SELF_SIGNED|UNABLE_TO_VERIFY/iu.test(msg)) return "tls";
  if (/EACCES|EPERM/u.test(msg)) return "permission";
  if (name === "SyntaxError") return "syntax";
  if (name === "TypeError") return "type";
  if (name === "UserError") return "user";
  return name;
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
