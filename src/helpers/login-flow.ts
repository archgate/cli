// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * login-flow.ts — Shared GitHub device flow + signup logic
 * used by both `login` and `init` commands.
 */

import { styleText } from "node:util";

import {
  requestDeviceCode,
  pollForAccessToken,
  getGitHubUser,
  claimArchgateToken,
} from "./auth";
import { saveCredentials } from "./credential-store";
import { logDebug, logError, logInfo } from "./log";
import { withPromptFix } from "./prompt";
import { SignupRequiredError, requestSignup } from "./signup";

export interface LoginFlowOptions {
  /**
   * Pre-selected editor for signup (skip the editor prompt).
   * When omitted, the user is prompted to choose.
   */
  editor?: string;
}

export interface LoginFlowResult {
  /** Whether credentials were obtained. */
  ok: boolean;
  /** GitHub username, if login succeeded. */
  githubUser?: string;
}

/**
 * Run the full GitHub device flow: authenticate, claim token (or sign up
 * if the user is unregistered), and store credentials.
 *
 * Returns `{ ok: true }` when credentials are stored, `{ ok: false }` on
 * failure (error is already printed).
 */
export async function runLoginFlow(
  options?: LoginFlowOptions
): Promise<LoginFlowResult> {
  console.log("By signing up, you agree to the Archgate Terms of Service:");
  console.log("https://archgate.dev/terms-of-service\n");

  logInfo("Authenticating with GitHub...\n");

  logDebug("Starting login flow");
  const deviceCode = await requestDeviceCode();
  logDebug(
    "Device code received, verification URI:",
    deviceCode.verification_uri
  );
  console.log(
    `Open ${styleText("bold", deviceCode.verification_uri)} in your browser`
  );
  console.log(
    `and enter the code: ${styleText(["bold", "green"], deviceCode.user_code)}\n`
  );
  console.log("Waiting for authorization...");

  const githubToken = await pollForAccessToken(
    deviceCode.device_code,
    deviceCode.interval,
    deviceCode.expires_in
  );

  const { login: githubUser, email: githubEmail } =
    await getGitHubUser(githubToken);
  logInfo(`GitHub user: ${styleText("bold", githubUser)}`);

  logInfo("Claiming archgate plugin token...");
  let archgateToken: string;
  try {
    archgateToken = await claimArchgateToken(githubToken);
    logDebug("Token claimed successfully");
  } catch (err) {
    if (!(err instanceof SignupRequiredError)) throw err;
    logDebug("Signup required — starting signup flow");

    console.log(
      `\nYour GitHub account ${styleText("bold", githubUser)} is not yet registered.`
    );
    console.log("Let's sign you up now.\n");

    const result = await runSignupPrompt(
      githubUser,
      githubToken,
      githubEmail,
      options?.editor
    );
    if (!result) return { ok: false };
    archgateToken = result;
  }

  await saveCredentials({ token: archgateToken, github_user: githubUser });

  logInfo(
    `Authenticated as ${styleText("bold", githubUser)}. Plugin access is now available.`
  );
  return { ok: true, githubUser };
}

/**
 * Prompt for signup details, submit the request, and return the token.
 * Returns null on failure (error is already printed).
 */
async function runSignupPrompt(
  githubUser: string,
  githubToken: string,
  githubEmail: string | null,
  preselectedEditor?: string
): Promise<string | null> {
  // Lazy-load inquirer — it costs ~200ms to parse and is only needed for
  // interactive signup prompts, not on every CLI startup.
  const { default: inquirer } = await import("inquirer");
  const { email } = await withPromptFix(() =>
    inquirer.prompt({
      type: "input",
      name: "email",
      message: "Email address:",
      default: githubEmail ?? undefined,
      validate: (v: string) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(v) || "Enter a valid email address",
    })
  );

  let editor = preselectedEditor;
  if (!editor) {
    const ans = await withPromptFix(() =>
      inquirer.prompt({
        type: "list",
        name: "editor",
        message: "Which editor will you use with archgate?",
        choices: [
          { name: "Claude Code", value: "claude-code" },
          { name: "VS Code", value: "vscode" },
          { name: "Copilot CLI", value: "copilot-cli" },
          { name: "Cursor", value: "cursor" },
        ],
      })
    );
    editor = ans.editor;
  }

  const { useCase } = await withPromptFix(() =>
    inquirer.prompt({
      type: "input",
      name: "useCase",
      message: "How do you plan to use archgate?",
      validate: (v: string) =>
        v.trim().length > 0 || "Please describe your use case",
    })
  );

  const { confirmed } = await withPromptFix(() =>
    inquirer.prompt({
      type: "confirm",
      name: "confirmed",
      message:
        "I agree to be contacted by the Archgate team to provide feedback during the beta period.",
      default: true,
    })
  );

  if (!confirmed) {
    logInfo("Signup cancelled.");
    return null;
  }

  logInfo("\nSubmitting signup request...");
  const result = await requestSignup(githubUser, email, useCase, editor!);

  if (!result.ok) {
    logError("Signup request failed. Please try again with `archgate login`.");
    return null;
  }

  if (result.token) return result.token;

  logInfo("Claiming archgate plugin token...");
  return claimArchgateToken(githubToken);
}
