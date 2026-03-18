/**
 * signup.ts — Archgate plugins platform signup for unregistered users.
 */

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

/**
 * Submit a signup request to the archgate plugins platform.
 * Returns true on success (201), false otherwise.
 */
export async function requestSignup(
  github: string,
  email: string,
  useCase: string
): Promise<boolean> {
  const response = await fetch(`${PLUGINS_API}/api/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "archgate-cli",
      Origin: PLUGINS_API,
    },
    body: JSON.stringify({ github, email, useCase }),
    signal: AbortSignal.timeout(15_000),
  });
  return response.status === 201;
}
