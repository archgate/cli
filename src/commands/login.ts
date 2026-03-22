import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";

import { loadCredentials, clearCredentials } from "../helpers/credential-store";
import { logError, logInfo } from "../helpers/log";
import { runLoginFlow } from "../helpers/login-flow";
import { findProjectRoot } from "../helpers/paths";
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
          "Run `archgate login refresh` to re-authenticate."
        );
        return;
      }

      const result = await runLoginFlow();
      if (result.ok) {
        printNextStep();
      } else {
        process.exit(1);
      }
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
        const result = await runLoginFlow();
        if (result.ok) {
          printNextStep();
        } else {
          process.exit(1);
        }
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

function printNextStep(): void {
  if (findProjectRoot()) {
    console.log(
      "Run `archgate check` to validate your project against its ADRs."
    );
  } else {
    console.log(
      "Run `archgate init` to set up a project with the archgate plugin."
    );
  }
}
