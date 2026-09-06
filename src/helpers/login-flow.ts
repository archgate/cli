// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * login-flow.ts — Shared Logto device flow used by `login` and `init`.
 */

import { styleText } from "node:util";

import { saveTokenSet } from "./credential-store";
import { copyToClipboard, openBrowser } from "./desktop";
import { registerGitCredentialHelper } from "./git-credential-config";
import { logDebug, logInfo, logWarn } from "./log";
import {
  identityFromIdToken,
  pollForTokens,
  requestDeviceCode,
} from "./logto-auth";
import { UserError } from "./user-error";

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

  const code = styleText(["bold", "green"], deviceCode.user_code);
  const copied = await copyToClipboard(deviceCode.user_code);

  // The complete URI carries the code as a query parameter, so a browser that
  // opens it leaves nothing to type. It is always printed as well: the browser
  // may not open, and the user may be reading this on another machine.
  const target =
    deviceCode.verification_uri_complete ?? deviceCode.verification_uri;
  const opened = await openBrowser(target);

  if (opened) {
    console.log(`Opened ${styleText("bold", target)} in your browser.`);
    console.log(
      `If it asks for a code, enter: ${code}${copied ? " (copied to your clipboard)" : ""}\n`
    );
  } else {
    console.log(`Open ${styleText("bold", target)} in your browser`);
    console.log(
      `and enter the code: ${code}${copied ? " (copied to your clipboard)" : ""}\n`
    );
  }

  console.log("Waiting for authorization...");

  const { tokens, idToken } = await pollForTokens(
    deviceCode.device_code,
    deviceCode.interval,
    deviceCode.expires_in
  );

  const user = identityFromIdToken(idToken);
  if (!(await saveTokenSet(user, tokens))) {
    throw new UserError(
      "Signed in, but the credentials could not be stored. Configure a git credential helper and run `archgate login` again."
    );
  }

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
