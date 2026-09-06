// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * platform-auth.ts — how the CLI signs in to the Archgate platform.
 *
 * The rest of the CLI reaches the platform's sign-in service only through
 * {@link platformAuth}. The mechanism behind it is an implementation detail:
 * changing providers means wiring a different {@link PlatformAuth} here, not
 * touching the login flow or the credential store.
 */

import { z } from "zod";

import { deviceFlowAuth } from "./oauth-device-flow";
import { PLUGINS_HOST } from "./plugin-install";

/** Host of the platform's sign-in service. */
export const AUTH_HOST = "auth.archgate.dev";

/** Renew this long before expiry so a token cannot lapse mid-request. */
const EXPIRY_SKEW_SECONDS = 60;

/** A token pair plus the absolute epoch-ms instant the access token lapses. */
export const TokenSetSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
});

export type TokenSet = z.infer<typeof TokenSetSchema>;

/** A signed-in account and the tokens that prove it. */
export interface Session {
  /** Display name of the account, shown by `archgate login status`. */
  user: string;
  tokens: TokenSet;
}

/** What the user must do to approve a sign-in started on this device. */
export interface DeviceAuthorization {
  /** Opaque handle polled until the user approves. */
  deviceCode: string;
  /** Short code the user types at {@link verificationUri}. */
  userCode: string;
  verificationUri: string;
  /** {@link verificationUri} with the code already filled in, when offered. */
  verificationUriComplete?: string;
  /** Seconds until the codes expire. */
  expiresIn: number;
  /** Seconds to wait between polls. */
  interval: number;
}

/** The sign-in operations the CLI needs from the platform. */
export interface PlatformAuth {
  /**
   * Start a sign-in on this device.
   *
   * @throws {UserError} When the platform rejects the request.
   */
  requestDeviceCode(): Promise<DeviceAuthorization>;

  /**
   * Wait until the user approves the sign-in.
   *
   * @param authorization - The pending sign-in from {@link requestDeviceCode}.
   * @throws {UserError} On denial, expiry, or a terminal platform error.
   */
  pollForTokens(authorization: DeviceAuthorization): Promise<Session>;

  /**
   * Trade a refresh token for a fresh token set.
   *
   * @param refreshToken - The stored refresh token.
   * @returns A new token set; the refresh token rotates, so store the result.
   * @throws {UserError} When the refresh token is expired or revoked.
   */
  refreshAccessToken(refreshToken: string): Promise<TokenSet>;
}

/** The platform's sign-in service, reached over the OAuth 2.0 device flow. */
export const platformAuth: PlatformAuth = deviceFlowAuth({
  deviceAuthorizationEndpoint: `https://${AUTH_HOST}/oidc/device/auth`,
  tokenEndpoint: `https://${AUTH_HOST}/oidc/token`,
  // A public client: a native app holds no secret.
  clientId: "gciwm5x5fc2hfr5zjy4ve",
  scope: "openid profile email offline_access",
  // The audience the plugins backend validates access tokens against.
  resource: `https://${PLUGINS_HOST}`,
});

/** True when `expiresAt` is in the past or close enough to treat as lapsed. */
export function isExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt - EXPIRY_SKEW_SECONDS * 1000;
}
