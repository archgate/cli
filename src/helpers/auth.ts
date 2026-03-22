/**
 * auth.ts — GitHub Device Flow authentication and registration management.
 *
 * Implements RFC 8628 (OAuth 2.0 Device Authorization Grant) for CLI login.
 * Users authenticate via GitHub credentials (git credential helpers) — no
 * archgate-specific tokens are needed. The login flow registers the user
 * and stores their GitHub username in ~/.archgate/credentials.
 */

import { chmodSync, unlinkSync } from "node:fs";

import { logDebug } from "./log";
import { internalPath, createPathIfNotExists } from "./paths";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_DEVICE_TOKEN_URL = "https://github.com/login/oauth/access_token";
const CREDENTIALS_FILE = "credentials";

/**
 * GitHub OAuth App client ID for the archgate CLI (public client — no secret).
 * Device flow apps are public clients; the client_id is not confidential.
 */
const GITHUB_CLIENT_ID = "Ov23liZUI9Aiv2ZrSAgn";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface DeviceTokenSuccessResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface DeviceTokenPendingResponse {
  error: "authorization_pending" | "slow_down";
  error_description?: string;
}

interface DeviceTokenErrorResponse {
  error: "expired_token" | "access_denied" | string;
  error_description?: string;
}

type DeviceTokenResponse =
  | DeviceTokenSuccessResponse
  | DeviceTokenPendingResponse
  | DeviceTokenErrorResponse;

export interface StoredCredentials {
  github_user: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GitHub Device Flow
// ---------------------------------------------------------------------------

/**
 * Step 1: Request a device code from GitHub.
 * The user will be shown the `user_code` and asked to visit `verification_uri`.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: "read:user" }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(
      `GitHub device code request failed (HTTP ${response.status})`
    );
  }

  return (await response.json()) as DeviceCodeResponse;
}

/**
 * Step 2: Poll GitHub until the user authorizes (or the code expires).
 * Returns the GitHub access token on success.
 */
export async function pollForAccessToken(
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<string> {
  const deadline = Date.now() + expiresIn * 1000;
  let pollInterval = interval;

  /* oxlint-disable no-await-in-loop -- sequential polling is required by RFC 8628 */
  while (Date.now() < deadline) {
    await Bun.sleep(pollInterval * 1000);

    const response = await fetch(GITHUB_DEVICE_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`GitHub token poll failed (HTTP ${response.status})`);
    }

    const data = (await response.json()) as DeviceTokenResponse;

    if ("access_token" in data) {
      return data.access_token;
    }

    if ("error" in data) {
      if (data.error === "authorization_pending") {
        continue;
      }
      if (data.error === "slow_down") {
        pollInterval += 5;
        continue;
      }
      // expired_token, access_denied, or other terminal error
      throw new Error(
        data.error_description ?? `GitHub authorization failed: ${data.error}`
      );
    }
  }
  /* oxlint-enable no-await-in-loop */

  throw new Error("Device code expired. Please try again.");
}

export interface GitHubUserInfo {
  login: string;
  email: string | null;
}

/**
 * Step 3: Get the authenticated GitHub user info.
 */
export async function getGitHubUser(
  accessToken: string
): Promise<GitHubUserInfo> {
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
  return { login: data.login, email: data.email ?? null };
}

// Re-export for consumers that import from auth.ts
export { SignupRequiredError, isSignupRequiredError } from "./signup";

// ---------------------------------------------------------------------------
// Credential Storage
// ---------------------------------------------------------------------------

function credentialsPath(): string {
  return internalPath(CREDENTIALS_FILE);
}

/**
 * Persist registration info to ~/.archgate/credentials (JSON).
 * Only stores GitHub username — no tokens (users authenticate via git credentials).
 */
export async function saveCredentials(
  credentials: StoredCredentials
): Promise<void> {
  createPathIfNotExists(internalPath());
  const filePath = credentialsPath();
  await Bun.write(filePath, JSON.stringify(credentials, null, 2) + "\n");
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // chmod may fail on Windows — NTFS uses ACLs instead
  }
  logDebug("Credentials saved to", filePath);
}

/**
 * Load stored credentials, or null if none exist.
 */
export async function loadCredentials(): Promise<StoredCredentials | null> {
  const file = Bun.file(credentialsPath());
  if (!(await file.exists())) {
    return null;
  }

  try {
    const data = (await file.json()) as StoredCredentials;
    if (!data.github_user) {
      return null;
    }
    return data;
  } catch {
    logDebug("Failed to parse credentials file");
    return null;
  }
}

/**
 * Remove stored credentials (logout).
 */
export async function clearCredentials(): Promise<void> {
  if (await Bun.file(credentialsPath()).exists()) {
    unlinkSync(credentialsPath());
    logDebug("Credentials removed");
  }
}
