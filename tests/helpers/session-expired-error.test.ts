// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { SessionExpiredError } from "../../src/helpers/session-expired-error";
import { UserError } from "../../src/helpers/user-error";

describe("SessionExpiredError", () => {
  // The credential store swallows this one as a signed-out state while every
  // other UserError propagates, so the subclass must remain distinguishable.
  test("is a UserError with its own name", () => {
    const error = new SessionExpiredError();

    expect(error).toBeInstanceOf(UserError);
    expect(error.name).toBe("SessionExpiredError");
  });

  test("tells the user to sign in again", () => {
    expect(new SessionExpiredError().message).toContain("archgate login");
  });
});
