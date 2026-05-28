// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * auth-poll.ts — RFC 8628 device code polling logic.
 *
 * Extracted from auth.ts so that test files can import `pollForAccessToken`
 * from a module path that is NOT targeted by `mock.module()` in
 * login-flow.test.ts. Bun's `mock.module` is process-global and retroactive
 * — it replaces live ESM bindings even for static imports — so the only
 * reliable isolation is a separate physical file.
 */

import { logDebug } from "./log";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_DEVICE_TOKEN_URL = "https://github.com/login/oauth/access_token";

/**
 * GitHub OAuth App client ID for the archgate CLI (public client — no secret).
 * Device flow apps are public clients; the client_id is not confidential.
 */
const GITHUB_CLIENT_ID = "Ov23liZUI9Aiv2ZrSAgn";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

/**
 * Poll GitHub until the user authorizes (or the code expires).
 * Returns the GitHub access token on success.
 */
export async function pollForAccessToken(
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<string> {
  const deadline = Date.now() + expiresIn * 1000;
  let pollInterval = interval;
  logDebug(
    "Starting device code polling, deadline:",
    new Date(deadline).toISOString()
  );

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
      logDebug("Access token received");
      return data.access_token;
    }

    if ("error" in data) {
      if (data.error === "authorization_pending") {
        logDebug("Authorization pending, retrying in", pollInterval, "seconds");
        continue;
      }
      if (data.error === "slow_down") {
        pollInterval += 5;
        logDebug("Slow down requested, new interval:", pollInterval, "seconds");
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
