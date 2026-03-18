import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";
import inquirer from "inquirer";

import {
  requestDeviceCode,
  pollForAccessToken,
  getGitHubUser,
  claimArchgateToken,
  saveCredentials,
  loadCredentials,
  clearCredentials,
} from "../helpers/auth";
import { logError, logInfo } from "../helpers/log";
import { SignupRequiredError, requestSignup } from "../helpers/signup";
import { isTlsError, tlsHintMessage } from "../helpers/tls";

export function registerLoginCommand(program: Command) {
  const login = program
    .command("login")
    .description("Authenticate with GitHub to access archgate plugins");

  login.action(async () => {
    try {
      // Check if already logged in
      const existing = await loadCredentials();
      if (existing) {
        logInfo(
          `Already logged in as ${styleText("bold", existing.github_user)}.`,
          "Run `archgate login --refresh` to re-authenticate."
        );
        return;
      }

      await runDeviceFlow();
    } catch (err) {
      if (isTlsError(err)) {
        logError(tlsHintMessage());
        process.exit(1);
      }
      logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

  login
    .command("status")
    .description("Show current authentication status")
    .action(async () => {
      const creds = await loadCredentials();
      if (creds) {
        console.log(
          `Logged in as ${styleText("bold", creds.github_user)} (since ${creds.created_at})`
        );
      } else {
        console.log("Not logged in. Run `archgate login` to authenticate.");
      }
    });

  login
    .command("logout")
    .description("Remove stored credentials")
    .action(async () => {
      await clearCredentials();
      console.log("Logged out successfully.");
    });

  login
    .command("refresh")
    .description("Re-authenticate and claim a new token")
    .action(async () => {
      try {
        await clearCredentials();
        await runDeviceFlow();
      } catch (err) {
        if (isTlsError(err)) {
          logError(tlsHintMessage());
          process.exit(1);
        }
        logError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}

async function runDeviceFlow(): Promise<void> {
  console.log("Authenticating with GitHub...\n");

  // Step 1: Request device code
  const deviceCode = await requestDeviceCode();

  console.log(
    `Open ${styleText("bold", deviceCode.verification_uri)} in your browser`
  );
  console.log(
    `and enter the code: ${styleText(["bold", "green"], deviceCode.user_code)}\n`
  );
  console.log("Waiting for authorization...");

  // Step 2: Poll for access token
  const githubToken = await pollForAccessToken(
    deviceCode.device_code,
    deviceCode.interval,
    deviceCode.expires_in
  );

  // Step 3: Get GitHub user info
  const { login: githubUser, email: githubEmail } =
    await getGitHubUser(githubToken);
  logInfo(`GitHub user: ${styleText("bold", githubUser)}`);

  // Step 4: Exchange GitHub token for archgate plugin token
  console.log("Claiming archgate plugin token...");
  try {
    const archgateToken = await claimArchgateToken(githubToken);
    await storeAndFinish(archgateToken, githubUser);
  } catch (err) {
    if (!(err instanceof SignupRequiredError)) throw err;

    console.log(
      `\nYour GitHub account ${styleText("bold", githubUser)} is not yet registered.`
    );
    console.log("Let's sign you up now.\n");

    await runSignupFlow(githubUser, githubToken, githubEmail);
  }
}

async function runSignupFlow(
  githubUser: string,
  githubToken: string,
  githubEmail: string | null
): Promise<void> {
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "email",
      message: "Email address:",
      default: githubEmail ?? undefined,
      validate: (v: string) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || "Enter a valid email address",
    },
    {
      type: "list",
      name: "editor",
      message: "Which editor will you use with archgate?",
      choices: [
        { name: "Claude Code", value: "claude-code" },
        { name: "Cursor", value: "cursor" },
      ],
    },
    {
      type: "input",
      name: "useCase",
      message: "How do you plan to use archgate?",
      validate: (v: string) =>
        v.trim().length > 0 || "Please describe your use case",
    },
  ]);

  console.log("\nSubmitting signup request...");
  const result = await requestSignup(
    githubUser,
    answers.email,
    answers.useCase,
    answers.editor
  );

  if (!result.ok) {
    logError(
      "Signup request failed. Please try again or sign up at https://plugins.archgate.dev"
    );
    process.exit(1);
  }

  // Use the token from signup if available, otherwise claim separately
  let archgateToken = result.token;
  if (!archgateToken) {
    console.log("Claiming archgate plugin token...");
    archgateToken = await claimArchgateToken(githubToken);
  }

  await storeAndFinish(archgateToken, githubUser);
}

async function storeAndFinish(
  archgateToken: string,
  githubUser: string
): Promise<void> {
  await saveCredentials({
    token: archgateToken,
    github_user: githubUser,
    created_at: new Date().toISOString().split("T")[0],
  });

  console.log(
    `\nAuthenticated as ${styleText("bold", githubUser)}. Plugin access is now available.`
  );
  console.log(
    "Run `archgate init` to set up a project with the archgate plugin."
  );
}
