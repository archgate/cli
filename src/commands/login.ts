// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";

import { loadCredentials, clearCredentials } from "../helpers/credential-store";
import { exitWith } from "../helpers/exit";
import { logError, logInfo } from "../helpers/log";
import { runLoginFlow } from "../helpers/login-flow";
import { findProjectRoot } from "../helpers/paths";
import { trackLoginResult } from "../helpers/telemetry";
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
      trackLoginResult({ subcommand: "login", success: result.ok });
      if (result.ok) {
        printNextStep();
      } else {
        await exitWith(1);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "ExitPromptError") throw err;
      const failureReason = isTlsError(err) ? "tls" : "other";
      trackLoginResult({
        subcommand: "login",
        success: false,
        failure_reason: failureReason,
      });
      if (isTlsError(err)) {
        logError(tlsHintMessage());
        await exitWith(1);
      }
      logError(err instanceof Error ? err.message : String(err));
      await exitWith(1);
    }
  });

  login
    .command("status")
    .description("Show current authentication status")
    .action(async () => {
      try {
        const creds = await loadCredentials();
        trackLoginResult({ subcommand: "status", success: creds !== null });
        if (creds) {
          console.log(`Logged in as ${styleText("bold", creds.github_user)}.`);
        } else {
          console.log("Not logged in. Run `archgate login` to authenticate.");
        }
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") throw err;
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });

  login
    .command("logout")
    .description("Remove stored credentials")
    .action(async () => {
      try {
        await clearCredentials();
        trackLoginResult({ subcommand: "logout", success: true });
        console.log("Logged out successfully.");
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") throw err;
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });

  login
    .command("refresh")
    .description("Re-authenticate and claim a new token")
    .action(async () => {
      try {
        await clearCredentials();
        const result = await runLoginFlow();
        trackLoginResult({ subcommand: "refresh", success: result.ok });
        if (result.ok) {
          printNextStep();
        } else {
          await exitWith(1);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") throw err;
        const failureReason = isTlsError(err) ? "tls" : "other";
        trackLoginResult({
          subcommand: "refresh",
          success: false,
          failure_reason: failureReason,
        });
        if (isTlsError(err)) {
          logError(tlsHintMessage());
          await exitWith(1);
        }
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
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
