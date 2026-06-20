// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { UserError } from "../../src/helpers/user-error";

describe("UserError", () => {
  test("is an instance of Error", () => {
    const err = new UserError("something went wrong");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UserError);
  });

  test("has name set to UserError", () => {
    const err = new UserError("test");
    expect(err.name).toBe("UserError");
  });

  test("uses the single message as-is", () => {
    const err = new UserError("No .archgate/ directory found.");
    expect(err.message).toBe("No .archgate/ directory found.");
  });

  test("joins multiple message segments with a space", () => {
    const err = new UserError(
      "Download failed (HTTP 404).",
      "Try again later."
    );
    expect(err.message).toBe("Download failed (HTTP 404). Try again later.");
  });

  test("is distinguishable from plain Error via instanceof", () => {
    const userErr = new UserError("expected");
    const plainErr = new Error("unexpected");
    expect(userErr instanceof UserError).toBe(true);
    expect(plainErr instanceof UserError).toBe(false);
  });
});
