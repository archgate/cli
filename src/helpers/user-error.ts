// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * user-error.ts — Typed error class for expected, user-facing failures.
 *
 * Helpers throw {@link UserError} for errors that are part of normal CLI
 * operation: invalid input, missing config, network failures, auth
 * rejections, etc.  These are "exit-code-1" errors — the user (or their
 * environment) needs to fix something, not us.
 *
 * Any error that is **not** a {@link UserError} is treated as an
 * unexpected bug and captured to Sentry via {@link handleCommandError}
 * in `exit.ts`.  This keeps Sentry focused on genuine crashes rather
 * than being flooded with routine validation noise.
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
    super(rest.length > 0 ? [message, ...rest].join(" ") : message);
    this.name = "UserError";
  }
}
