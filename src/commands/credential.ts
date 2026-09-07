// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";

import {
  invalidateAccessToken,
  resolveAccessToken,
} from "../helpers/credential-store";
import { handleCommandError } from "../helpers/exit";
import {
  type CredentialRequest,
  formatCredentialResponse,
  parseCredentialRequest,
} from "../helpers/git-credential-protocol";
import { logDebug } from "../helpers/log";
import { PLUGINS_HOST } from "../helpers/plugin-install";
import { readStdinText } from "../helpers/stdin";

/**
 * Read the credential request git writes to stdin.
 *
 * @returns The parsed request, or an empty one when stdin is closed.
 */
async function readRequest(): Promise<CredentialRequest> {
  return parseCredentialRequest(await readStdinText());
}

/**
 * True for a request this helper answers.
 *
 * Git uses the requested protocol for the exchange itself, so an `http://`
 * request would carry the token in cleartext; only `https` to the plugins
 * host qualifies, and the response cannot upgrade the protocol.
 */
function isPluginsRequest(request: CredentialRequest): boolean {
  return request.protocol === "https" && request.host === PLUGINS_HOST;
}

/**
 * True when this process was started by git as its credential helper.
 *
 * Startup must then stay silent and quick: stdout is the protocol channel,
 * and git is blocked waiting for it. Any argument list naming `credential`
 * qualifies; skipping the git install check for a false positive is harmless.
 *
 * @param argv - `process.argv` or an equivalent.
 */
export function isCredentialHelperInvocation(argv: readonly string[]): boolean {
  return argv.slice(2).includes("credential");
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
        if (!isPluginsRequest(request)) {
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
        if (isPluginsRequest(await readRequest())) {
          await invalidateAccessToken();
        }
      } catch (err) {
        await handleCommandError(err);
      }
    });
}
