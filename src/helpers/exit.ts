// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Centralized process-exit helper. Exits go through {@link exitWith}, which
 * records a `command_completed` telemetry event and flushes PostHog/Sentry
 * before exiting; a direct `process.exit` skips both and drops the event.
 * A module-level guard prevents double-counting when both `exitWith` and
 * Commander's `postAction` hook fire for the same invocation.
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

  const resolvedCurrentCommand =
    currentCommand !== null && currentCommand !== ""
      ? currentCommand
      : "unknown";
  const name = fullCommand === "" ? resolvedCurrentCommand : fullCommand;
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
 * Terminate the process after recording + flushing telemetry. Use instead of
 * `process.exit(code)` in command actions and the top-level error boundary.
 *
 * @param code - Process exit code: 0 success, 1 user error, 2 internal
 * error, 130 cancellation.
 * @param opts - `outcome` overrides the telemetry outcome tag that otherwise
 * derives from `code`; `errorKind` attaches a {@link classifyErrorKind} tag.
 * @returns Typed `Promise<never>` — control never returns to the caller.
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
 * Quiet exit after the consumer of our output pipe went away (EPIPE). By
 * pipeline convention (`archgate adr list | head`) a closed reader means
 * "I have all I need" — success, not an error. Nothing is logged: the
 * output channel is gone, and stderr may be too.
 *
 * @returns Typed `Promise<never>` — control never returns to the caller.
 */
export async function exitForBrokenPipe(): Promise<never> {
  return exitWith(0, { outcome: "cancelled", errorKind: "broken_pipe" });
}

/**
 * Centralized error handler for command catch blocks (ARCH-012). Helpers
 * throw {@link UserError} for expected failures: those are logged and never
 * sent to Sentry.
 *
 * @param err - The caught error, of any shape.
 * @throws The original error when it is an `ExitPromptError`, so
 * `main().catch()` handles Ctrl+C as exit 130.
 * @returns Never returns: exits 1 for a {@link UserError}, or captures to
 * Sentry and exits 2 for an unexpected bug.
 * @see {@link exitWith}
 */
export async function handleCommandError(err: unknown): Promise<never> {
  if (err instanceof Error && err.name === "ExitPromptError") throw err;

  const errorKind = classifyErrorKind(err);
  const isExpected = err instanceof UserError;

  if (!isExpected) {
    captureException(err, { command: currentCommand ?? "unknown", errorKind });
  }

  logError(err instanceof Error ? err.message : String(err));
  // UserError = user-fixable (code 1), everything else = internal bug (code 2)
  return exitWith(isExpected ? 1 : 2, { errorKind });
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Whether an error is a broken-pipe (`EPIPE`) write failure — the reader
 * side of stdout/stderr closed while the CLI was still writing.
 *
 * @param err - The error to inspect, of any shape.
 */
export function isEpipeError(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "EPIPE";
}

/**
 * Classify an error into a high-level bucket for telemetry.
 *
 * @param err - The error to classify, of any shape.
 * @returns A short tag such as `network` or `tls` — never the raw error
 * message, which could carry user data.
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
