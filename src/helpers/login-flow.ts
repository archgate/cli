/**
 * login-flow.ts — Shared GitHub device flow + signup logic
 * used by both `login` and `init` commands.
 *
 * The login flow authenticates the user via GitHub Device Flow and
 * registers them on the archgate plugins platform. No archgate-specific
 * tokens are created — users authenticate to the plugin service using
 * their existing git credentials (GitHub PAT or OAuth token).
 */

import { styleText } from "node:util";

import inquirer from "inquirer";

import {
  requestDeviceCode,
  pollForAccessToken,
  getGitHubUser,
  saveCredentials,
} from "./auth";
import { logError, logInfo } from "./log";
import { requestSignup } from "./signup";

export interface LoginFlowOptions {
  /**
   * Pre-selected editor for signup (skip the editor prompt).
   * When omitted, the user is prompted to choose.
   */
  editor?: string;
}

export interface LoginFlowResult {
  /** Whether registration was successful. */
  ok: boolean;
  /** GitHub username, if login succeeded. */
  githubUser?: string;
}

/**
 * Run the full GitHub device flow: authenticate, register (or verify
 * registration), and store the GitHub username locally.
 *
 * Returns `{ ok: true }` when registration is confirmed, `{ ok: false }` on
 * failure (error is already printed).
 */
export async function runLoginFlow(
  options?: LoginFlowOptions
): Promise<LoginFlowResult> {
  logInfo("Authenticating with GitHub...\n");

  const deviceCode = await requestDeviceCode();
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

  // Try to register — the signup endpoint auto-approves
  logInfo("Checking registration status...");
  const signupResult = await runSignupFlow(
    githubUser,
    githubEmail,
    options?.editor
  );
  if (!signupResult) return { ok: false };

  await saveCredentials({
    github_user: githubUser,
    created_at: new Date().toISOString().split("T")[0],
  });

  logInfo(
    `Registered as ${styleText("bold", githubUser)}. Plugin access is now available via your git credentials.`
  );
  return { ok: true, githubUser };
}

/**
 * Register the user on the archgate platform.
 * Returns true on success, null on failure (error is already printed).
 */
async function runSignupFlow(
  githubUser: string,
  githubEmail: string | null,
  preselectedEditor?: string
): Promise<boolean | null> {
  const { email } = await inquirer.prompt({
    type: "input",
    name: "email",
    message: "Email address:",
    default: githubEmail ?? undefined,
    validate: (v: string) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || "Enter a valid email address",
  });

  let editor = preselectedEditor;
  if (!editor) {
    const ans = await inquirer.prompt({
      type: "list",
      name: "editor",
      message: "Which editor will you use with archgate?",
      choices: [
        { name: "Claude Code", value: "claude-code" },
        { name: "VS Code", value: "vscode" },
        { name: "Copilot CLI", value: "copilot-cli" },
        { name: "Cursor", value: "cursor" },
      ],
    });
    editor = ans.editor;
  }

  const { useCase } = await inquirer.prompt({
    type: "input",
    name: "useCase",
    message: "How do you plan to use archgate?",
    validate: (v: string) =>
      v.trim().length > 0 || "Please describe your use case",
  });

  const { confirmed } = await inquirer.prompt({
    type: "confirm",
    name: "confirmed",
    message:
      "I agree to be contacted by the Archgate team to provide feedback during the beta period.",
    default: true,
  });

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

  return true;
}
