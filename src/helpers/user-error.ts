// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * user-error.ts — Typed error class for expected, user-facing failures
 * (invalid input, missing config, network/auth errors): "exit-code-1"
 * errors the user fixes. {@link handleCommandError} in `exit.ts` captures
 * to Sentry anything that is neither a {@link UserError} nor an
 * `ExitPromptError` (Ctrl+C cancellation, exit 130).
 *
 * @example
 * ```ts
 * import { UserError } from "../helpers/user-error";
 *
 * if (!existsSync(configPath)) {
 *   throw new UserError("No .archgate/ directory found.", "Run `archgate init` first.");
 * }
 * ```
 */

/**
 * An expected, user-facing error.
 *
 * Multiple message segments are joined with a space, mirroring the
 * variadic `logError(...args)` signature so callers can keep the same
 * ergonomics.
 */
export class UserError extends Error {
  constructor(message: string, ...rest: string[]) {
    super(rest.length > 0 ? `${message} ${rest.join(" ")}` : message);
    this.name = "UserError";
  }
}
