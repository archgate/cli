// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * oauth-device-flow.ts — sign-in over the OAuth 2.0 device authorization
 * grant (RFC 8628) with refresh-token renewal (RFC 6749 §6).
 *
 * Knows nothing about which service it talks to: every endpoint and client
 * detail arrives through {@link DeviceFlowConfig}.
 */

import { z } from "zod";

import type {
  DeviceAuthorization,
  PlatformAuth,
  Session,
  TokenSet,
} from "./platform-auth";
import { UserError } from "./user-error";

/** Where and as whom to sign in. */
export interface DeviceFlowConfig {
  /** RFC 8628 device authorization endpoint. */
  deviceAuthorizationEndpoint: string;
  /** OAuth 2.0 token endpoint, used for both grants. */
  tokenEndpoint: string;
  /** Public client identifier; a native app holds no secret. */
  clientId: string;
  /** Space-separated scopes; must include `offline_access` for a refresh token. */
  scope: string;
  /** Resource indicator (RFC 8707) the access token is minted for. */
  resource: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

/** RFC 8628 default when the server omits `interval`. */
const DEFAULT_POLL_INTERVAL_SECONDS = 5;

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/** Display name when the ID token offers nothing usable. */
const FALLBACK_USER = "archgate";

const DeviceCodeSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  verification_uri_complete: z.string().optional(),
  expires_in: z.number(),
  interval: z.number().default(DEFAULT_POLL_INTERVAL_SECONDS),
});

const TokenSuccessSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  expires_in: z.number(),
});

type TokenSuccess = z.infer<typeof TokenSuccessSchema>;

const TokenErrorSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

const IdTokenClaimsSchema = z.object({
  sub: z.string(),
  username: z.string().nullish(),
  name: z.string().nullish(),
  email: z.string().nullish(),
});

/**
 * Build a {@link PlatformAuth} that signs in through the given endpoints.
 *
 * @param config - Endpoints and client identity of the sign-in service.
 */
export function deviceFlowAuth(config: DeviceFlowConfig): PlatformAuth {
  return {
    async requestDeviceCode(): Promise<DeviceAuthorization> {
      const response = await postForm(config.deviceAuthorizationEndpoint, {
        client_id: config.clientId,
        scope: config.scope,
        resource: config.resource,
      });
      if (!response.ok) {
        throw new UserError(
          `Could not start sign-in (HTTP ${response.status}). Please try again.`
        );
      }

      const parsed = DeviceCodeSchema.safeParse(await jsonBody(response));
      if (!parsed.success) throw unexpectedResponse();
      return {
        deviceCode: parsed.data.device_code,
        userCode: parsed.data.user_code,
        verificationUri: parsed.data.verification_uri,
        verificationUriComplete: parsed.data.verification_uri_complete,
        expiresIn: parsed.data.expires_in,
        interval: parsed.data.interval,
      };
    },

    async pollForTokens(authorization: DeviceAuthorization): Promise<Session> {
      const deadline = Date.now() + authorization.expiresIn * 1000;
      let interval = authorization.interval;

      /* oxlint-disable no-await-in-loop -- sequential polling is required by RFC 8628 */
      while (Date.now() < deadline) {
        await Bun.sleep(interval * 1000);

        const response = await postForm(config.tokenEndpoint, {
          client_id: config.clientId,
          grant_type: DEVICE_GRANT,
          device_code: authorization.deviceCode,
        });
        const body = await jsonBody(response);

        if (response.ok) {
          const granted = parseTokenResponse(body);
          return {
            user: userFromIdToken(granted.id_token),
            tokens: toTokenSet(granted),
          };
        }

        const error = TokenErrorSchema.safeParse(body);
        if (!error.success) throw unexpectedResponse();

        switch (error.data.error) {
          case "authorization_pending":
            break;
          case "slow_down":
            interval += DEFAULT_POLL_INTERVAL_SECONDS;
            break;
          case "access_denied":
            throw new UserError("Sign-in was denied.");
          case "expired_token":
            throw codeExpired();
          default:
            throw new UserError(
              error.data.error_description ??
                `Sign-in failed: ${error.data.error}`
            );
        }
      }
      /* oxlint-enable no-await-in-loop */

      throw codeExpired();
    },

    async refreshAccessToken(refreshToken: string): Promise<TokenSet> {
      const response = await postForm(config.tokenEndpoint, {
        client_id: config.clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        resource: config.resource,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new UserError(
          "Your session has expired. Run `archgate login` to sign in again."
        );
      }
      return toTokenSet(
        parseTokenResponse(await jsonBody(response)),
        refreshToken
      );
    },
  };
}

/**
 * Send a form-encoded POST, giving up after {@link REQUEST_TIMEOUT_MS}.
 *
 * Redirects are refused: a 307 or 308 would replay the body, which carries a
 * device code or refresh token, to whatever host the `Location` names.
 */
async function postForm(
  url: string,
  fields: Record<string, string>
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * Read a JSON body, yielding `null` for one that is not JSON.
 *
 * A proxy answering with an HTML error page would otherwise surface as a
 * `SyntaxError` — an internal fault that reaches Sentry — instead of the
 * user-facing error the caller raises for an unexpected body.
 */
async function jsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function unexpectedResponse(): UserError {
  return new UserError("Sign-in service returned an unexpected response.");
}

function codeExpired(): UserError {
  return new UserError(
    "The sign-in code expired. Run `archgate login` to try again."
  );
}

/** @throws {UserError} When the body is not a token grant. */
function parseTokenResponse(body: unknown): TokenSuccess {
  const parsed = TokenSuccessSchema.safeParse(body);
  if (!parsed.success) throw unexpectedResponse();
  return parsed.data;
}

/**
 * Turn a token grant into a {@link TokenSet}.
 *
 * @param granted - The parsed token response.
 * @param fallbackRefreshToken - Kept when the grant omits a rotated one.
 * @throws {UserError} When no refresh token is available from either source.
 */
function toTokenSet(
  granted: TokenSuccess,
  fallbackRefreshToken?: string
): TokenSet {
  const refreshToken = granted.refresh_token ?? fallbackRefreshToken;
  if (refreshToken === undefined || refreshToken === "") {
    throw new UserError(
      "Sign-in did not return a refresh token. Please try again."
    );
  }
  return {
    accessToken: granted.access_token,
    refreshToken,
    expiresAt: Date.now() + granted.expires_in * 1000,
  };
}

/**
 * Pick a display name out of an ID token: username, name, email or subject,
 * in that order. Presentation only — the access token is what the backend
 * verifies, so nothing here is trusted for authorization.
 */
function userFromIdToken(idToken: string | undefined): string {
  const parts = idToken?.split(".") ?? [];
  const payload = parts.length >= 3 ? parts[1] : undefined;
  if (payload === undefined || payload === "") return FALLBACK_USER;

  try {
    const claims = IdTokenClaimsSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    );
    if (!claims.success) return FALLBACK_USER;
    return (
      claims.data.username ??
      claims.data.name ??
      claims.data.email ??
      claims.data.sub
    );
  } catch {
    return FALLBACK_USER;
  }
}
