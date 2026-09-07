// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { UserError } from "./user-error";

/**
 * The platform refused the stored refresh token, so the user is signed out.
 *
 * Distinct from other {@link UserError}s so callers can treat it as an
 * expected state rather than a failure to report.
 */
export class SessionExpiredError extends UserError {
  constructor() {
    super("Your session has expired. Run `archgate login` to sign in again.");
    this.name = "SessionExpiredError";
  }
}
