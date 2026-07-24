// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * user-error.ts — Typed error class for expected, user-facing failures
 * (invalid input, missing config, network/auth errors): "exit-code-1"
 * errors the user fixes. Anything that is NOT a {@link UserError} counts as
 * an unexpected bug and is captured to Sentry via {@link handleCommandError}
 * in `exit.ts`.
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
