// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * login-flow.ts — Shared Logto device flow used by `login` and `init`.
 */

import { styleText } from "node:util";

import { saveTokenSet } from "./credential-store";
import { registerGitCredentialHelper } from "./git-credential-config";
import { logDebug, logInfo, logWarn } from "./log";
import {
  identityFromIdToken,
  pollForTokens,
  requestDeviceCode,
} from "./logto-auth";

export interface LoginFlowResult {
  /** Whether credentials were obtained. */
  ok: boolean;
  /** Signed-in account name, if login succeeded. */
  githubUser?: string;
}

/**
 * Run the Logto device authorization flow and store the resulting tokens.
 *
 * Registers archgate as git's credential helper for the plugins host so that
 * `git clone` of a plugin repository gets a freshly minted access token.
 *
 * @returns `{ ok: true }` once credentials are stored.
 */
export async function runLoginFlow(): Promise<LoginFlowResult> {
  console.log("By signing in, you agree to the Archgate Terms of Service:");
  console.log("https://archgate.dev/terms-of-service\n");

  logDebug("Starting Logto device flow");
  const deviceCode = await requestDeviceCode();

  console.log(
    `Open ${styleText("bold", deviceCode.verification_uri)} in your browser`
  );
  console.log(
    `and enter the code: ${styleText(["bold", "green"], deviceCode.user_code)}\n`
  );
  console.log("Waiting for authorization...");

  const { tokens, idToken } = await pollForTokens(
    deviceCode.device_code,
    deviceCode.interval,
    deviceCode.expires_in
  );

  const user = identityFromIdToken(idToken);
  await saveTokenSet(user, tokens);

  if (!(await registerGitCredentialHelper())) {
    logWarn(
      "Could not register archgate as a git credential helper.",
      "Plugin downloads still work; `git clone` of a plugin repository may prompt for credentials."
    );
  }

  logInfo(
    `Authenticated as ${styleText("bold", user)}. Plugin access is now available.`
  );
  return { ok: true, githubUser: user };
}
