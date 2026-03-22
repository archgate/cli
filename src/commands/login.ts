import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";

import { loadCredentials, clearCredentials } from "../helpers/auth";
import { logError, logInfo } from "../helpers/log";
import { runLoginFlow } from "../helpers/login-flow";
import { findProjectRoot } from "../helpers/paths";
import { isTlsError, tlsHintMessage } from "../helpers/tls";

export function registerLoginCommand(program: Command) {
  const login = program
    .command("login")
    .description("Authenticate with GitHub and register for archgate plugins");

  login.action(async () => {
    try {
      // Check if already registered
      const existing = await loadCredentials();
      if (existing) {
        logInfo(
          `Already registered as ${styleText("bold", existing.github_user)}.`,
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
    .description("Show current registration status")
    .action(async () => {
      const creds = await loadCredentials();
      if (creds) {
        console.log(
          `Registered as ${styleText("bold", creds.github_user)} (since ${creds.created_at})`
        );
      } else {
        console.log("Not registered. Run `archgate login` to sign up.");
      }
    });

  login
    .command("logout")
    .description("Remove stored registration info")
    .action(async () => {
      await clearCredentials();
      console.log("Logged out successfully.");
    });

  login
    .command("refresh")
    .description("Re-authenticate and update registration")
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
