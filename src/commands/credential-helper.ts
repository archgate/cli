/**
 * credential-helper.ts — Git credential helper for archgate plugins.
 *
 * Git calls this command when it needs credentials for plugins.archgate.dev.
 * It reads the archgate token from the OS credential manager (Bun.secrets)
 * and outputs it in the git credential helper protocol format.
 *
 * Usage (configured automatically by `archgate login`):
 *   git config --global credential.https://plugins.archgate.dev.helper "archgate credential-helper"
 *
 * Git credential helper protocol:
 *   - Git calls: `archgate credential-helper get` and passes host info on stdin
 *   - Helper outputs: `username=<handle>\npassword=<token>\n`
 *
 * @see https://git-scm.com/docs/gitcredentials
 */

import type { Command } from "@commander-js/extra-typings";

import { loadCredentials } from "../helpers/auth";

export function registerCredentialHelperCommand(program: Command) {
  program
    .command("credential-helper")
    .description("Git credential helper for archgate plugins (internal)")
    .argument("[action]", "credential helper action (get, store, erase)")
    .action(async (action) => {
      // Only respond to "get" — store and erase are no-ops
      if (action !== "get") return;

      const credentials = await loadCredentials();
      if (!credentials) {
        // No credentials → exit silently, git will try next helper or prompt
        return;
      }

      // Output in git credential helper format
      // Each field is on its own line, terminated by a blank line
      process.stdout.write(`username=${credentials.github_user}\n`);
      process.stdout.write(`password=${credentials.token}\n`);
      process.stdout.write("\n");
    });
}
