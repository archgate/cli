// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";

import {
  clearCredentials,
  loadCredentials,
  loadTokenSet,
} from "../helpers/credential-store";
import { exitWith, handleCommandError } from "../helpers/exit";
import {
  ensureGitCredentialHelper,
  unregisterGitCredentialHelper,
} from "../helpers/git-credential-config";
import { logInfo } from "../helpers/log";
import { runLoginFlow } from "../helpers/login-flow";
import { findProjectRoot } from "../helpers/paths";
import { trackLoginResult } from "../helpers/telemetry";
import { isTlsError, tlsHintMessage } from "../helpers/tls";
import { UserError } from "../helpers/user-error";

export function registerLoginCommand(program: Command) {
  const login = program
    .command("login")
    .description("Log in to the Archgate platform");

  login.action(async () => {
    try {
      const existing = await loadCredentials();
      if (existing) {
        logInfo(
          `Already logged in as ${styleText("bold", existing.github_user)}.`,
          "Run `archgate login refresh` to sign in again."
        );
        // A platform session may have been stored while the helper write
        // failed; a legacy token must not get the helper, which cannot serve it.
        if (await loadTokenSet()) await ensureGitCredentialHelper();
        return;
      }
      await signIn("login");
    } catch (err) {
      await handleSignInError("login", err);
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
        await handleCommandError(err);
      }
    });

  login
    .command("logout")
    .description("Remove stored credentials")
    .action(async () => {
      try {
        // The helper goes first: while archgate answers for the plugins host,
        // clearing cannot see a legacy token the OS store holds for it.
        const unregistered = await unregisterGitCredentialHelper();
        const cleared = await clearCredentials();
        trackLoginResult({
          subcommand: "logout",
          success: unregistered && cleared,
        });
        if (!cleared) {
          throw new UserError(
            "Some credentials could not be removed from your git credential manager.",
            "Check `git config --global credential.helper` and run `archgate login logout` again."
          );
        }
        if (!unregistered) {
          throw new UserError(
            "Credentials removed, but the git credential helper entry could not be removed. Remove it with `git config --global --unset-all credential.https://plugins.archgate.dev.helper`."
          );
        }
        console.log("Logged out successfully.");
      } catch (err) {
        await handleCommandError(err);
      }
    });

  login
    .command("refresh")
    .description("Re-authenticate and claim a new token")
    .action(async () => {
      try {
        await unregisterGitCredentialHelper();
        await clearCredentials();
        await signIn("refresh");
      } catch (err) {
        await handleSignInError("refresh", err);
      }
    });
}

/**
 * Run the sign-in flow and report its outcome.
 *
 * @param subcommand - Reported to telemetry with the outcome.
 */
async function signIn(subcommand: "login" | "refresh"): Promise<void> {
  const result = await runLoginFlow();
  trackLoginResult({ subcommand, success: result.ok });
  if (result.ok) {
    printNextStep();
  } else {
    await exitWith(1);
  }
}

/**
 * Report a failed sign-in, with a dedicated hint for TLS interception.
 *
 * @param subcommand - Reported to telemetry with the failure.
 * @param err - Whatever the action threw; prompt cancellations propagate.
 */
async function handleSignInError(
  subcommand: "login" | "refresh",
  err: unknown
): Promise<void> {
  if (err instanceof Error && err.name === "ExitPromptError") throw err;
  const tls = isTlsError(err);
  trackLoginResult({
    subcommand,
    success: false,
    failure_reason: tls ? "tls" : "other",
  });
  // The hint replaces the raw error; as a UserError it keeps exit code 1 and
  // the handler's expected-error classification.
  await handleCommandError(tls ? new UserError(tlsHintMessage()) : err);
}

function printNextStep(): void {
  const projectRoot = findProjectRoot();
  if (projectRoot !== null && projectRoot !== "") {
    console.log(
      "Run `archgate check` to validate your project against its ADRs."
    );
  } else {
    console.log(
      "Run `archgate init` to set up a project with the archgate plugin."
    );
  }
}
