import { describe, expect, test } from "bun:test";

import {
  SignupRequiredError,
  isSignupRequiredError,
} from "../../src/helpers/signup";

describe("SignupRequiredError", () => {
  test("is an instance of Error", () => {
    const err = new SignupRequiredError();
    expect(err).toBeInstanceOf(Error);
  });

  test("has the correct name", () => {
    expect(new SignupRequiredError().name).toBe("SignupRequiredError");
  });

  test("has a descriptive message", () => {
    expect(new SignupRequiredError().message).toContain("No approved signup");
  });
});

describe("isSignupRequiredError", () => {
  test("matches 'No approved signup found'", () => {
    expect(
      isSignupRequiredError("No approved signup found for this GitHub account")
    ).toBe(true);
  });

  test("matches 'not registered'", () => {
    expect(isSignupRequiredError("User is not registered")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isSignupRequiredError("NO APPROVED SIGNUP")).toBe(true);
  });

  test("returns false for unrelated messages", () => {
    expect(isSignupRequiredError("Token expired")).toBe(false);
  });

  test("returns false for no argument", () => {
    expect(isSignupRequiredError()).toBe(false);
  });
});
