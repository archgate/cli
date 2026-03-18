import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";

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

  // Step 3: Get GitHub username
  const githubUser = await getGitHubUser(githubToken);
  logInfo(`GitHub user: ${styleText("bold", githubUser)}`);

  // Step 4: Exchange GitHub token for archgate plugin token
  console.log("Claiming archgate plugin token...");
  const archgateToken = await claimArchgateToken(githubToken);

  // Step 5: Store credentials
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
