// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * logto-auth.ts — Logto device authorization and token refresh.
 *
 * Implements RFC 8628 against the Archgate platform. Access tokens
 * are short-lived; the refresh token obtained via `offline_access` is what
 * survives, and {@link refreshAccessToken} trades it for a new pair.
 */

import { z } from "zod";

import { logDebug } from "./log";
import { UserError } from "./user-error";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOGTO_ENDPOINT = "https://auth.archgate.dev";
const DEVICE_AUTH_URL = `${LOGTO_ENDPOINT}/oidc/device/auth`;
const TOKEN_URL = `${LOGTO_ENDPOINT}/oidc/token`;

/** Public client — a native app holds no secret. */
const CLIENT_ID = "gciwm5x5fc2hfr5zjy4ve";

/** Audience the plugins backend validates access tokens against. */
export const PLUGINS_RESOURCE = "https://plugins.archgate.dev";

const SCOPES = "openid profile email offline_access";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/** RFC 8628 default when the server omits `interval`. */
const DEFAULT_POLL_INTERVAL_SECONDS = 5;

/** Renew this long before expiry so a token cannot lapse mid-request. */
const EXPIRY_SKEW_SECONDS = 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const DeviceCodeSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  verification_uri_complete: z.string().optional(),
  expires_in: z.number(),
  interval: z.number().default(DEFAULT_POLL_INTERVAL_SECONDS),
});

export type DeviceCode = z.infer<typeof DeviceCodeSchema>;

const TokenSuccessSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  expires_in: z.number(),
});

const IdTokenClaimsSchema = z.object({
  sub: z.string(),
  username: z.string().nullish(),
  name: z.string().nullish(),
  email: z.string().nullish(),
});

const TokenErrorSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

/** A token pair plus the absolute epoch-ms instant the access token lapses. */
export const TokenSetSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
});

export type TokenSet = z.infer<typeof TokenSetSchema>;

/** A token set plus the ID token from the exchange that produced it. */
export const TokenSetWithIdentitySchema = z.object({
  tokens: TokenSetSchema,
  idToken: z.string().optional(),
});

export type TokenSetWithIdentity = z.infer<typeof TokenSetWithIdentitySchema>;

// ---------------------------------------------------------------------------
// Device authorization
// ---------------------------------------------------------------------------

/**
 * Start a device authorization request.
 *
 * @returns The user code and verification URI to show the user.
 * @throws {UserError} When the Archgate platform rejects the request.
 */
export async function requestDeviceCode(): Promise<DeviceCode> {
  logDebug("Requesting Logto device code from:", DEVICE_AUTH_URL);
  const response = await fetch(DEVICE_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: SCOPES,
      resource: PLUGINS_RESOURCE,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new UserError(
      `Could not start sign-in (HTTP ${response.status}). Please try again.`
    );
  }

  const parsed = DeviceCodeSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new UserError("Sign-in service returned an unexpected response.");
  }
  return parsed.data;
}

/**
 * Poll the token endpoint until the user authorizes, the code expires, or the
 * provider reports a terminal error.
 *
 * @param deviceCode - The `device_code` from {@link requestDeviceCode}.
 * @param intervalSeconds - Server-supplied poll interval.
 * @param expiresInSeconds - Lifetime of the device code.
 * @returns The token set once the user has authorized.
 * @throws {UserError} On denial, expiry, or a terminal provider error.
 */
export async function pollForTokens(
  deviceCode: string,
  intervalSeconds: number,
  expiresInSeconds: number
): Promise<TokenSetWithIdentity> {
  const deadline = Date.now() + expiresInSeconds * 1000;
  let interval = intervalSeconds;

  /* oxlint-disable no-await-in-loop -- sequential polling is required by RFC 8628 */
  while (Date.now() < deadline) {
    await Bun.sleep(interval * 1000);

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: DEVICE_GRANT,
        device_code: deviceCode,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const body: unknown = await jsonBody(response);

    if (response.ok) {
      return { tokens: toTokenSet(body), idToken: idTokenFrom(body) };
    }

    const error = TokenErrorSchema.safeParse(body);
    if (!error.success) {
      throw new UserError("Sign-in service returned an unexpected response.");
    }

    switch (error.data.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        interval += DEFAULT_POLL_INTERVAL_SECONDS;
        break;
      case "access_denied":
        throw new UserError("Sign-in was denied.");
      case "expired_token":
        throw new UserError(
          "The sign-in code expired. Run `archgate login` to try again."
        );
      default:
        throw new UserError(
          error.data.error_description ?? `Sign-in failed: ${error.data.error}`
        );
    }
  }
  /* oxlint-enable no-await-in-loop */

  throw new UserError(
    "The sign-in code expired. Run `archgate login` to try again."
  );
}

// ---------------------------------------------------------------------------
// Token renewal
// ---------------------------------------------------------------------------

/**
 * Trade a refresh token for a fresh access token.
 *
 * @param refreshToken - The stored refresh token.
 * @returns A new token set; the refresh token rotates, so store the result.
 * @throws {UserError} When the refresh token is expired or revoked.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenSet> {
  logDebug("Refreshing Logto access token");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      resource: PLUGINS_RESOURCE,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new UserError(
      "Your session has expired. Run `archgate login` to sign in again."
    );
  }

  return toTokenSet(await jsonBody(response), refreshToken);
}

/**
 * Read a display name out of an ID token.
 *
 * The claims are used for presentation only — the plugins backend verifies the
 * access token independently, so nothing here is trusted for authorization.
 *
 * @param idToken - Compact JWS from the token endpoint.
 * @returns A username, name, email or subject, in that order of preference.
 */
export function identityFromIdToken(idToken: string | undefined): string {
  if (idToken === undefined || idToken === "") return "archgate";
  const parts = idToken.split(".");
  if (parts.length < 3) return "archgate";
  const payload = parts[1];
  if (payload === "") return "archgate";

  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );
    const claims = IdTokenClaimsSchema.safeParse(decoded);
    if (!claims.success) return "archgate";
    return (
      claims.data.username ??
      claims.data.name ??
      claims.data.email ??
      claims.data.sub
    );
  } catch {
    return "archgate";
  }
}

/** True when `expiresAt` is in the past or close enough to treat as lapsed. */
export function isExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt - EXPIRY_SKEW_SECONDS * 1000;
}

/**
 * Read a JSON body without letting a non-JSON one escape as an internal error.
 *
 * An Archgate platform outage answers with an HTML error page from a proxy,
 * where `response.json()` rejects with a `SyntaxError` — not a `UserError`, so
 * it would surface as an internal fault and reach Sentry.
 *
 * @returns The parsed body, or `null` when it is not JSON.
 */
async function jsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Pull the raw ID token out of a token response, when present. */
function idTokenFrom(body: unknown): string | undefined {
  return TokenSuccessSchema.safeParse(body).data?.id_token;
}

/**
 * Normalize a token response into a {@link TokenSet}.
 *
 * @param body - Parsed JSON from the token endpoint.
 * @param fallbackRefreshToken - Kept when the response omits a rotated one.
 */
function toTokenSet(body: unknown, fallbackRefreshToken?: string): TokenSet {
  const parsed = TokenSuccessSchema.safeParse(body);
  if (!parsed.success) {
    throw new UserError("Sign-in service returned an unexpected response.");
  }

  const refreshToken = parsed.data.refresh_token ?? fallbackRefreshToken;
  if (refreshToken === undefined || refreshToken === "") {
    throw new UserError(
      "Sign-in did not return a refresh token. Please try again."
    );
  }

  return {
    accessToken: parsed.data.access_token,
    refreshToken,
    expiresAt: Date.now() + parsed.data.expires_in * 1000,
  };
}
