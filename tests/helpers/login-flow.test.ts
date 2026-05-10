// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { runLoginFlow } from "../../src/helpers/login-flow";
import type {
  LoginFlowOptions,
  LoginFlowResult,
} from "../../src/helpers/login-flow";

describe("login-flow", () => {
  test("runLoginFlow is exported as a function", () => {
    expect(typeof runLoginFlow).toBe("function");
  });

  test("LoginFlowOptions accepts editor field", () => {
    const opts: LoginFlowOptions = { editor: "claude-code" };
    expect(opts.editor).toBe("claude-code");
  });

  test("LoginFlowResult shape", () => {
    const success: LoginFlowResult = { ok: true, githubUser: "octocat" };
    expect(success.ok).toBe(true);
    expect(success.githubUser).toBe("octocat");

    const failure: LoginFlowResult = { ok: false };
    expect(failure.ok).toBe(false);
    expect(failure.githubUser).toBeUndefined();
  });
});
