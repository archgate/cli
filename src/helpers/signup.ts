// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * signup.ts — Archgate plugins platform signup for unregistered users.
 */

import { logDebug } from "./log";

const PLUGINS_API = "https://plugins.archgate.dev";

/**
 * Sentinel error thrown when the token claim endpoint reports that the
 * GitHub account has no approved signup.
 */
export class SignupRequiredError extends Error {
  constructor() {
    super("No approved signup found for this GitHub account");
    this.name = "SignupRequiredError";
  }
}

/**
 * Returns true if the error message indicates the user needs to sign up.
 */
export function isSignupRequiredError(message?: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("no approved signup") || lower.includes("not registered")
  );
}

interface SignupResult {
  ok: boolean;
  /** Token returned by the API when signup is auto-approved. */
  token: string | null;
}

/**
 * Submit a signup request to the archgate plugins platform.
 * On auto-approved signups the API returns the token directly,
 * avoiding a separate claim round-trip.
 */
export async function requestSignup(
  github: string,
  email: string,
  useCase: string,
  editor: string = "claude-code"
): Promise<SignupResult> {
  logDebug("Submitting signup request for:", github);
  const response = await fetch(`${PLUGINS_API}/api/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "archgate-cli",
      Origin: PLUGINS_API,
    },
    body: JSON.stringify({ github, email, useCase, editor }),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });

  if (response.status !== 201) {
    logDebug("Signup request failed, status:", response.status);
    return { ok: false, token: null };
  }

  const data = (await response.json().catch(() => ({}))) as { token?: string };
  logDebug("Signup successful, token provided:", Boolean(data.token));
  return { ok: true, token: data.token ?? null };
}
