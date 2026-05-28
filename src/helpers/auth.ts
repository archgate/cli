// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * auth.ts — GitHub Device Flow authentication and archgate token management.
 *
 * Implements RFC 8628 (OAuth 2.0 Device Authorization Grant) for CLI login.
 * Token storage is delegated to credential-store.ts which uses git's native
 * credential helpers (macOS Keychain, Windows Credential Manager, libsecret).
 */

// Re-export pollForAccessToken as a wrapper (NOT a live re-export) so that
// mock.module("auth") in login-flow.test.ts does NOT follow the binding chain
// into auth-poll.ts. A live `export { X } from "./Y"` creates a binding that
// Bun's mock.module replaces at the source, poisoning auth-poll.ts for other
// test files. A wrapper function is its own binding — mocking auth.ts replaces
// the wrapper, leaving auth-poll.ts's binding untouched.
import { pollForAccessToken as pollForAccessTokenImpl } from "./auth-poll";
import { logDebug } from "./log";
import { SignupRequiredError, isSignupRequiredError } from "./signup";

export async function pollForAccessToken(
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<string> {
  return await pollForAccessTokenImpl(deviceCode, interval, expiresIn);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLUGINS_API = "https://plugins.archgate.dev";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";

/**
 * GitHub OAuth App client ID for the archgate CLI (public client — no secret).
 * Device flow apps are public clients; the client_id is not confidential.
 */
const GITHUB_CLIENT_ID = "Ov23liZUI9Aiv2ZrSAgn";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

// ---------------------------------------------------------------------------
// GitHub Device Flow
// ---------------------------------------------------------------------------

/**
 * Step 1: Request a device code from GitHub.
 * The user will be shown the `user_code` and asked to visit `verification_uri`.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  logDebug("Requesting device code from:", GITHUB_DEVICE_CODE_URL);
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: "read:user" }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    logDebug("Device code request failed, status:", response.status);
    throw new Error(
      `GitHub device code request failed (HTTP ${response.status})`
    );
  }

  const data = (await response.json()) as DeviceCodeResponse;
  logDebug("Device code received, expires in:", data.expires_in, "seconds");
  return data;
}

interface GitHubUserInfo {
  login: string;
  email: string | null;
}

/**
 * Step 3: Get the authenticated GitHub user info.
 */
export async function getGitHubUser(
  accessToken: string
): Promise<GitHubUserInfo> {
  logDebug("Fetching GitHub user info");
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "archgate-cli",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub user (HTTP ${response.status})`);
  }

  const data = (await response.json()) as {
    login?: string;
    email?: string | null;
  };
  if (!data.login) {
    throw new Error("GitHub API did not return a username");
  }
  logDebug("GitHub user:", data.login);
  return { login: data.login, email: data.email ?? null };
}

// ---------------------------------------------------------------------------
// Token Claim
// ---------------------------------------------------------------------------

/**
 * Exchange a GitHub access token for an archgate plugin token
 * via POST /api/token/claim on the plugins service.
 */
export async function claimArchgateToken(githubToken: string): Promise<string> {
  logDebug("Claiming archgate token from:", `${PLUGINS_API}/api/token/claim`);
  const response = await fetch(`${PLUGINS_API}/api/token/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "archgate-cli",
    },
    body: JSON.stringify({ github_token: githubToken }),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };

    if (isSignupRequiredError(body.error)) {
      throw new SignupRequiredError();
    }

    const message =
      body.error ?? `Token claim failed (HTTP ${response.status})`;
    throw new Error(message);
  }

  const data = (await response.json()) as { token?: string };
  if (!data.token) {
    throw new Error("Plugins service did not return a token");
  }
  logDebug("Archgate token claimed successfully");
  return data.token;
}
