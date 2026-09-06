// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";

import {
  invalidateAccessToken,
  PLUGINS_HOST,
  resolveAccessToken,
} from "../helpers/credential-store";
import { handleCommandError } from "../helpers/exit";
import {
  formatCredentialResponse,
  parseCredentialRequest,
} from "../helpers/git-credential-protocol";
import { logDebug } from "../helpers/log";

/**
 * Read the credential request git writes to stdin.
 *
 * @returns The parsed request, or an empty one when stdin is closed.
 */
async function readRequest(): Promise<Record<string, string>> {
  const raw = await Bun.stdin.text();
  return parseCredentialRequest(raw);
}

export function registerCredentialCommand(program: Command) {
  const credential = program
    .command("credential")
    .description("Git credential helper for archgate plugin repositories");

  credential
    .command("get")
    .description("Print credentials for a plugin repository")
    .action(async () => {
      try {
        const request = await readRequest();
        // Git uses the requested protocol for the exchange itself, so an
        // http:// request would carry the token in cleartext. Answering only
        // https keeps that from happening; the response cannot upgrade it.
        if (request.protocol !== "https" || request.host !== PLUGINS_HOST) {
          logDebug(
            "Ignoring credential request for:",
            `${request.protocol}://${request.host}`
          );
          return;
        }

        const credentials = await resolveAccessToken();
        if (!credentials) {
          logDebug("No stored credentials; deferring to other helpers");
          return;
        }

        process.stdout.write(
          formatCredentialResponse({
            protocol: "https",
            host: PLUGINS_HOST,
            username: credentials.github_user,
            password: credentials.token,
          })
        );
      } catch (err) {
        await handleCommandError(err);
      }
    });

  credential
    .command("store")
    .description("Accept a credential from git (no-op)")
    .action(async () => {
      try {
        // Tokens come from `archgate login`, so git has nothing to teach us.
        await readRequest();
      } catch (err) {
        await handleCommandError(err);
      }
    });

  credential
    .command("erase")
    .description("Drop the cached access token when git reports it rejected")
    .action(async () => {
      try {
        const request = await readRequest();
        if (request.protocol !== "https" || request.host !== PLUGINS_HOST) {
          return;
        }
        await invalidateAccessToken();
      } catch (err) {
        await handleCommandError(err);
      }
    });
}
