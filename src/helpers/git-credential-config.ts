// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * git-credential-config.ts — register archgate as git's credential helper.
 *
 * Scoped to the plugins host alone, so credentials for every other host keep
 * using whatever helper the user already configured.
 */

import { PLUGINS_HOST } from "./credential-store";
import { logDebug } from "./log";

/** Config key holding the helper list for the plugins host. */
const HELPER_KEY = `credential.https://${PLUGINS_HOST}.helper`;

/** Shell form git invokes; `!` marks it as a command rather than a suffix. */
const HELPER_VALUE = "!archgate credential";

/**
 * Run a git command, resolving to its exit code.
 *
 * The environment is passed explicitly: `Bun.spawn` snapshots the environment
 * at startup, so a later `Bun.env` assignment — which is how tests redirect
 * `GIT_CONFIG_GLOBAL` — would otherwise not reach git.
 */
async function git(args: string[]): Promise<number> {
  // Only the exit code matters; unread pipes can block git once it writes
  // enough diagnostic output to fill them.
  const proc = Bun.spawn(["git", ...args], {
    stdout: "ignore",
    stderr: "ignore",
    env: { ...Bun.env },
  });
  return proc.exited;
}

/**
 * Point git at archgate for plugin-host credentials.
 *
 * An empty value is written first: git accumulates helpers across config
 * scopes, and the empty entry resets any inherited list so archgate is the
 * only helper consulted for this host.
 *
 * @returns `true` when both config writes succeed.
 */
export async function registerGitCredentialHelper(): Promise<boolean> {
  const reset = await git([
    "config",
    "--global",
    "--replace-all",
    HELPER_KEY,
    "",
  ]);
  if (reset !== 0) return false;

  const added = await git([
    "config",
    "--global",
    "--add",
    HELPER_KEY,
    HELPER_VALUE,
  ]);
  if (added !== 0) return false;

  logDebug("Registered archgate as git credential helper for", PLUGINS_HOST);
  return true;
}

/**
 * Remove archgate from git's credential configuration for the plugins host.
 *
 * @returns `true` when the section was removed or was already absent.
 */
export async function unregisterGitCredentialHelper(): Promise<boolean> {
  const code = await git(["config", "--global", "--unset-all", HELPER_KEY]);
  // Exit code 5 means the key was not set, which is the desired end state.
  return code === 0 || code === 5;
}
