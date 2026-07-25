// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, mock } from "bun:test";

import {
  SignupRequiredError,
  isSignupRequiredError,
  requestSignup,
} from "../../src/helpers/signup";

/** Type-safe fetch mock — Bun's fetch type includes `preconnect` which mock() doesn't provide. */
function mockFetch(handler: () => Promise<Response>) {
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
  test("returns ok=true and token on 201 with token", async () => {
    const originalFetch = globalThis.fetch;
    mockFetch(() =>
      Promise.resolve(
        Response.json({ token: "ag_beta_auto_approved" }, { status: 201 })
      )
    );

    try {
      const result = await requestSignup(
        "octocat",
        "octo@example.com",
        "testing"
      );
      expect(result.ok).toBe(true);
      expect(result.token).toBe("ag_beta_auto_approved");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns ok=true and token=null on 201 without token (manual approval)", async () => {
    const originalFetch = globalThis.fetch;
    mockFetch(() => Promise.resolve(Response.json({}, { status: 201 })));

    try {
      const result = await requestSignup(
        "octocat",
        "octo@example.com",
        "testing"
      );
      expect(result.ok).toBe(true);
      expect(result.token).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns ok=false and token=null on non-201 status", async () => {
    const originalFetch = globalThis.fetch;
    mockFetch(() => Promise.resolve(new Response("Conflict", { status: 409 })));

    try {
      const result = await requestSignup(
        "octocat",
        "octo@example.com",
        "testing"
      );
      expect(result.ok).toBe(false);
      expect(result.token).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns ok=true and token=null when response.json() throws", async () => {
    const originalFetch = globalThis.fetch;
    mockFetch(() => Promise.resolve(new Response("not-json", { status: 201 })));

    try {
      const result = await requestSignup(
        "octocat",
        "octo@example.com",
        "testing"
      );
      expect(result.ok).toBe(true);
      expect(result.token).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("propagates rejection when fetch fails (e.g. network error or timeout)", async () => {
    const originalFetch = globalThis.fetch;
    mockFetch(() => Promise.reject(new Error("network down")));

    try {
      await expect(
        requestSignup("octocat", "octo@example.com", "testing")
      ).rejects.toThrow("network down");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("sends default editor=claude-code when editor not provided", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: string | null = null;

    globalThis.fetch = mock(
      (_input: string | URL | Request, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return Promise.resolve(
          Response.json({ token: "ag_beta_tok" }, { status: 201 })
        );
      }
    ) as unknown as typeof fetch;

    try {
      await requestSignup("octocat", "octo@example.com", "testing");
      expect(capturedBody).not.toBeNull();
      const parsed = JSON.parse(capturedBody!);
      expect(parsed.editor).toBe("claude-code");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
