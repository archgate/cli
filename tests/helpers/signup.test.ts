// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test, mock } from "bun:test";

import {
  SignupRequiredError,
  isSignupRequiredError,
  requestSignup,
} from "../../src/helpers/signup";

/** Type-safe fetch mock — Bun's fetch type includes `preconnect` which mock() doesn't provide. */
function mockFetch(handler: () => Promise<Response>) {
  // Deliberately incomplete fake: mock() can't reproduce fetch's full type
  // (preconnect etc.), and only the callable shape is ever exercised.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  globalThis.fetch = mock(handler) as unknown as typeof fetch;
}

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
  test.each<[string | undefined, boolean]>([
    ["No approved signup found for this GitHub account", true],
    ["User is not registered", true],
    ["NO APPROVED SIGNUP", true],
    ["Token expired", false],
    [undefined, false],
  ])("returns %p for %p", (input, expected) => {
    expect(isSignupRequiredError(input)).toBe(expected);
  });
});

describe("requestSignup", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns ok=true and token on 201 with token", async () => {
    mockFetch(async () =>
      Response.json({ token: "ag_beta_auto_approved" }, { status: 201 })
    );

    const result = await requestSignup(
      "octocat",
      "octo@example.com",
      "testing"
    );
    expect(result.ok).toBe(true);
    expect(result.token).toBe("ag_beta_auto_approved");
  });

  test("returns ok=true and token=null on 201 without token (manual approval)", async () => {
    mockFetch(async () => Response.json({}, { status: 201 }));

    const result = await requestSignup(
      "octocat",
      "octo@example.com",
      "testing"
    );
    expect(result.ok).toBe(true);
    expect(result.token).toBeNull();
  });

  test("returns ok=false and token=null on non-201 status", async () => {
    mockFetch(async () => new Response("Conflict", { status: 409 }));

    const result = await requestSignup(
      "octocat",
      "octo@example.com",
      "testing"
    );
    expect(result.ok).toBe(false);
    expect(result.token).toBeNull();
  });

  test("returns ok=true and token=null when response.json() throws", async () => {
    mockFetch(async () => new Response("not-json", { status: 201 }));

    const result = await requestSignup(
      "octocat",
      "octo@example.com",
      "testing"
    );
    expect(result.ok).toBe(true);
    expect(result.token).toBeNull();
  });

  test("propagates rejection when fetch fails (e.g. network error or timeout)", async () => {
    mockFetch(async () => {
      throw new Error("network down");
    });

    expect(
      requestSignup("octocat", "octo@example.com", "testing")
    ).rejects.toThrow("network down");
  });

  test("sends default editor=claude-code when editor not provided", async () => {
    let capturedBody: string | null = null;

    // Deliberately incomplete fake: only the callable shape is exercised.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = mock(
      async (_input: string | URL | Request, init?: RequestInit) => {
        capturedBody = typeof init?.body === "string" ? init.body : null;
        return Response.json({ token: "ag_beta_tok" }, { status: 201 });
      }
    ) as unknown as typeof fetch;

    await requestSignup("octocat", "octo@example.com", "testing");
    expect(capturedBody).not.toBeNull();
    const parsed: unknown = JSON.parse(capturedBody!);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("editor" in parsed)
    ) {
      throw new Error("expected a parsed request body with an editor field");
    }
    expect(parsed.editor).toBe("claude-code");
  });
});
