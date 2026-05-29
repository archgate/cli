// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports that use them.
// ---------------------------------------------------------------------------

/** Mock cursorTo from node:readline (used by prompt.ts withPromptFix). */
mock.module("node:readline", () => ({ cursorTo: mock(() => true) }));

// Auth + credential-store stubs are installed per-test via spyOn (see
// beforeEach), NOT mock.module. spyOn is auto-restored and scoped to this
// file; mock.module is process-global and would leak mocked implementations
// into auth.test.ts and credential-store.test.ts.
let mockRequestDeviceCode: ReturnType<typeof spyOn>;
let mockPollForAccessToken: ReturnType<typeof spyOn>;
let mockGetGitHubUser: ReturnType<typeof spyOn>;
let mockClaimArchgateToken: ReturnType<typeof spyOn>;
let mockSaveCredentials: ReturnType<typeof spyOn>;

// Mock inquirer for the signup flow prompts (lazy-loaded via dynamic import).
// Use Record<string, unknown> as return type so mockImplementation can return
// different shapes for different prompts (email, editor, useCase, confirmed).
const mockInquirerPrompt = mock(
  (): Promise<Record<string, unknown>> =>
    Promise.resolve({ email: "test@example.com" })
);
mock.module("inquirer", () => ({ default: { prompt: mockInquirerPrompt } }));

// ---------------------------------------------------------------------------
// Import SignupRequiredError BEFORE mocking — we need the real class so
// instanceof checks in login-flow.ts work correctly.
// Note: we do NOT mock signup.ts to avoid cross-test contamination with
// signup.test.ts (which uses static imports).
// ---------------------------------------------------------------------------

import * as authMod from "../../src/helpers/auth";
import * as credMod from "../../src/helpers/credential-store";
import { runLoginFlow } from "../../src/helpers/login-flow";
// ---------------------------------------------------------------------------
// Imports under test — loaded AFTER mocks are registered.
// ---------------------------------------------------------------------------
import type {
  LoginFlowOptions,
  LoginFlowResult,
} from "../../src/helpers/login-flow";
import { SignupRequiredError } from "../../src/helpers/signup";

// ---------------------------------------------------------------------------
// Fetch mock for signup endpoint — requestSignup() uses globalThis.fetch.
// Per ARCH-005: assign globalThis.fetch directly, don't use mock.module.
// ---------------------------------------------------------------------------

let originalFetch: typeof globalThis.fetch;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("login-flow", () => {
  beforeEach(() => {
    // Silence console output (restored via mock.restore() in afterEach).
    spyOn(console, "log").mockImplementation(() => {});
    spyOn(console, "error").mockImplementation(() => {});

    // Save original fetch — only needed for signup tests that go through
    // the real requestSignup function.
    originalFetch = globalThis.fetch;

    // Install fresh per-test spies with default implementations.
    mockRequestDeviceCode = spyOn(
      authMod,
      "requestDeviceCode"
    ).mockResolvedValue({
      device_code: "dc-test-123",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });
    mockPollForAccessToken = spyOn(
      authMod,
      "pollForAccessToken"
    ).mockResolvedValue("gh-token-test-456");
    mockGetGitHubUser = spyOn(authMod, "getGitHubUser").mockResolvedValue({
      login: "octocat",
      email: "octocat@github.com",
    });
    mockClaimArchgateToken = spyOn(
      authMod,
      "claimArchgateToken"
    ).mockResolvedValue("archgate-token-789");
    mockSaveCredentials = spyOn(credMod, "saveCredentials").mockImplementation(
      () => Promise.resolve()
    );

    mockInquirerPrompt.mockClear();
    mockInquirerPrompt.mockImplementation(() =>
      Promise.resolve({ email: "test@example.com" })
    );
  });

  afterEach(() => {
    // Restore all spyOn spies (console + auth + credential-store).
    mock.restore();
    globalThis.fetch = originalFetch;
  });

  // -----------------------------------------------------------------------
  // Type exports
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Successful login flow
  // -----------------------------------------------------------------------

  test("successful login: device code -> poll -> claim -> save", async () => {
    const result = await runLoginFlow();

    expect(result.ok).toBe(true);
    expect(result.githubUser).toBe("octocat");

    // Verify the full auth chain was called
    expect(mockRequestDeviceCode).toHaveBeenCalledTimes(1);
    expect(mockPollForAccessToken).toHaveBeenCalledTimes(1);
    expect(mockPollForAccessToken).toHaveBeenCalledWith("dc-test-123", 5, 900);
    expect(mockGetGitHubUser).toHaveBeenCalledTimes(1);
    expect(mockGetGitHubUser).toHaveBeenCalledWith("gh-token-test-456");
    expect(mockClaimArchgateToken).toHaveBeenCalledTimes(1);
    expect(mockClaimArchgateToken).toHaveBeenCalledWith("gh-token-test-456");
    expect(mockSaveCredentials).toHaveBeenCalledTimes(1);
    expect(mockSaveCredentials).toHaveBeenCalledWith({
      token: "archgate-token-789",
      github_user: "octocat",
    });
  });

  // -----------------------------------------------------------------------
  // requestDeviceCode failure
  // -----------------------------------------------------------------------

  test("requestDeviceCode throws -> propagates error", async () => {
    mockRequestDeviceCode.mockImplementation(() =>
      Promise.reject(new Error("GitHub device code request failed (HTTP 500)"))
    );

    await expect(runLoginFlow()).rejects.toThrow(
      "GitHub device code request failed"
    );
    expect(mockPollForAccessToken).not.toHaveBeenCalled();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // pollForAccessToken failure
  // -----------------------------------------------------------------------

  test("pollForAccessToken throws -> propagates error", async () => {
    mockPollForAccessToken.mockImplementation(() =>
      Promise.reject(new Error("Device code expired"))
    );

    await expect(runLoginFlow()).rejects.toThrow("Device code expired");
    expect(mockClaimArchgateToken).not.toHaveBeenCalled();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // getGitHubUser failure
  // -----------------------------------------------------------------------

  test("getGitHubUser throws -> propagates error", async () => {
    mockGetGitHubUser.mockImplementation(() =>
      Promise.reject(new Error("Failed to fetch GitHub user (HTTP 401)"))
    );

    await expect(runLoginFlow()).rejects.toThrow("Failed to fetch GitHub user");
    expect(mockClaimArchgateToken).not.toHaveBeenCalled();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // claimArchgateToken throws SignupRequiredError -> enters signup flow
  // -----------------------------------------------------------------------

  test("signup required: auto-approved token returned from signup", async () => {
    // First call to claimArchgateToken throws SignupRequiredError
    mockClaimArchgateToken.mockImplementation(() =>
      Promise.reject(new SignupRequiredError())
    );

    // Mock fetch for the signup endpoint — requestSignup uses globalThis.fetch
    globalThis.fetch = ((url: string | URL | Request) => {
      const urlStr =
        typeof url === "string"
          ? url
          : url instanceof URL
            ? url.toString()
            : url.url;
      if (urlStr.includes("/api/signup")) {
        return Promise.resolve(
          Response.json({ token: "auto-approved-token" }, { status: 201 })
        );
      }
      return originalFetch(url);
    }) as unknown as typeof fetch;

    // Mock the sequence of inquirer prompts:
    // 1. email -> 2. editor -> 3. useCase -> 4. confirmed
    let promptCallCount = 0;
    mockInquirerPrompt.mockImplementation(() => {
      promptCallCount++;
      switch (promptCallCount) {
        case 1:
          return Promise.resolve({ email: "test@example.com" });
        case 2:
          return Promise.resolve({ editor: "vscode" });
        case 3:
          return Promise.resolve({ useCase: "governance" });
        case 4:
          return Promise.resolve({ confirmed: true });
        default:
          return Promise.resolve({});
      }
    });

    const result = await runLoginFlow();

    expect(result.ok).toBe(true);
    expect(result.githubUser).toBe("octocat");
    expect(mockSaveCredentials).toHaveBeenCalledWith({
      token: "auto-approved-token",
      github_user: "octocat",
    });
  });

  // -----------------------------------------------------------------------
  // Signup flow: no token from signup, fallback to claimArchgateToken
  // -----------------------------------------------------------------------

  test("signup without auto-token falls back to second claim call", async () => {
    // First claimArchgateToken call throws, second succeeds
    let claimCallCount = 0;
    mockClaimArchgateToken.mockImplementation(() => {
      claimCallCount++;
      if (claimCallCount === 1) {
        return Promise.reject(new SignupRequiredError());
      }
      return Promise.resolve("fallback-token-xyz");
    });

    // Mock fetch for the signup endpoint — no token returned
    globalThis.fetch = ((url: string | URL | Request) => {
      const urlStr =
        typeof url === "string"
          ? url
          : url instanceof URL
            ? url.toString()
            : url.url;
      if (urlStr.includes("/api/signup")) {
        return Promise.resolve(Response.json({}, { status: 201 }));
      }
      return originalFetch(url);
    }) as unknown as typeof fetch;

    let promptCallCount = 0;
    mockInquirerPrompt.mockImplementation(() => {
      promptCallCount++;
      switch (promptCallCount) {
        case 1:
          return Promise.resolve({ email: "test@example.com" });
        case 2:
          return Promise.resolve({ editor: "cursor" });
        case 3:
          return Promise.resolve({ useCase: "testing" });
        case 4:
          return Promise.resolve({ confirmed: true });
        default:
          return Promise.resolve({});
      }
    });

    const result = await runLoginFlow();

    expect(result.ok).toBe(true);
    expect(claimCallCount).toBe(2);
    expect(mockSaveCredentials).toHaveBeenCalledWith({
      token: "fallback-token-xyz",
      github_user: "octocat",
    });
  });

  // -----------------------------------------------------------------------
  // Signup cancelled by user (confirmed = false)
  // -----------------------------------------------------------------------

  test("signup cancelled (confirmed=false) -> returns ok:false", async () => {
    mockClaimArchgateToken.mockImplementation(() =>
      Promise.reject(new SignupRequiredError())
    );

    let promptCallCount = 0;
    mockInquirerPrompt.mockImplementation(() => {
      promptCallCount++;
      switch (promptCallCount) {
        case 1:
          return Promise.resolve({ email: "test@example.com" });
        case 2:
          return Promise.resolve({ editor: "vscode" });
        case 3:
          return Promise.resolve({ useCase: "testing" });
        case 4:
          return Promise.resolve({ confirmed: false });
        default:
          return Promise.resolve({});
      }
    });

    const result = await runLoginFlow();

    expect(result.ok).toBe(false);
    expect(result.githubUser).toBeUndefined();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Signup request fails (API returns non-201)
  // -----------------------------------------------------------------------

  test("signup request fails -> returns ok:false", async () => {
    mockClaimArchgateToken.mockImplementation(() =>
      Promise.reject(new SignupRequiredError())
    );

    // Mock fetch for the signup endpoint — returns failure
    globalThis.fetch = ((url: string | URL | Request) => {
      const urlStr =
        typeof url === "string"
          ? url
          : url instanceof URL
            ? url.toString()
            : url.url;
      if (urlStr.includes("/api/signup")) {
        return Promise.resolve(new Response("Conflict", { status: 409 }));
      }
      return originalFetch(url);
    }) as unknown as typeof fetch;

    let promptCallCount = 0;
    mockInquirerPrompt.mockImplementation(() => {
      promptCallCount++;
      switch (promptCallCount) {
        case 1:
          return Promise.resolve({ email: "test@example.com" });
        case 2:
          return Promise.resolve({ editor: "vscode" });
        case 3:
          return Promise.resolve({ useCase: "testing" });
        case 4:
          return Promise.resolve({ confirmed: true });
        default:
          return Promise.resolve({});
      }
    });

    const result = await runLoginFlow();

    expect(result.ok).toBe(false);
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Pre-selected editor in options -> skips editor prompt
  // -----------------------------------------------------------------------

  test("pre-selected editor skips editor prompt in signup flow", async () => {
    mockClaimArchgateToken.mockImplementation(() =>
      Promise.reject(new SignupRequiredError())
    );

    let signupBody: Record<string, string> | null = null;
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      signupBody = JSON.parse(init?.body as string);
      return Promise.resolve(
        Response.json({ token: "editor-preset-token" }, { status: 201 })
      );
    }) as unknown as typeof fetch;

    // With preselected editor, only 3 prompts: email, useCase, confirmed
    let promptCallCount = 0;
    mockInquirerPrompt.mockImplementation(() => {
      promptCallCount++;
      switch (promptCallCount) {
        case 1:
          return Promise.resolve({ email: "test@example.com" });
        case 2:
          return Promise.resolve({ useCase: "governance" });
        case 3:
          return Promise.resolve({ confirmed: true });
        default:
          return Promise.resolve({});
      }
    });

    const result = await runLoginFlow({ editor: "claude-code" });

    expect(result.ok).toBe(true);
    // The pre-selected editor "claude-code" should be passed to requestSignup
    expect(signupBody).not.toBeNull();
    expect(signupBody!.editor).toBe("claude-code");
    // Only 3 prompts (no editor prompt)
    expect(promptCallCount).toBe(3);
  });

  // -----------------------------------------------------------------------
  // claimArchgateToken throws non-SignupRequired error -> propagates
  // -----------------------------------------------------------------------

  test("claimArchgateToken throws non-signup error -> propagates", async () => {
    mockClaimArchgateToken.mockImplementation(() =>
      Promise.reject(new Error("Token claim failed (HTTP 500)"))
    );

    await expect(runLoginFlow()).rejects.toThrow("Token claim failed");
    expect(mockSaveCredentials).not.toHaveBeenCalled();
  });
});
