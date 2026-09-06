// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * git-credential-config.ts — register archgate as git's credential helper.
 *
 * Scoped to the plugins host alone, so credentials for every other host keep
 * using whatever helper the user already configured.
 */

import { selfInvokeArgv } from "./install-info";
import { logDebug } from "./log";
import { PLUGINS_HOST } from "./plugin-install";

/** Config key holding the helper list for the plugins host. */
const HELPER_KEY = `credential.https://${PLUGINS_HOST}.helper`;

/**
 * Quote one argument for the POSIX shell git runs `!` helpers through.
 *
 * Backslashes become forward slashes: Git for Windows runs helpers through
 * its bundled `sh`, which treats a backslash inside quotes as an escape.
 *
 * @param arg - Executable path or argument.
 */
export function quoteForGitShell(arg: string): string {
  const slashed = arg.replaceAll("\\", "/");
  if (/^[\w./:@%+=-]+$/u.test(slashed)) return slashed;
  return `'${slashed.replaceAll("'", "'\\''")}'`;
}

/**
 * Shell form git invokes; `!` marks it as a command rather than a helper name.
 *
 * The executable is recorded by absolute path: git started by an editor or a
 * GUI client rarely inherits the shell PATH that holds `archgate`.
 */
export function helperCommand(): string {
  return `!${selfInvokeArgv(["credential"])
    .map((arg) => quoteForGitShell(arg))
    .join(" ")}`;
}

/**
 * Run a git command, resolving to its exit code; 1 when git cannot start.
 *
 * The environment is passed explicitly: `Bun.spawn` snapshots the environment
 * at startup, so a later `Bun.env` assignment — which is how tests redirect
 * `GIT_CONFIG_GLOBAL` — would otherwise not reach git.
 */
async function git(args: string[]): Promise<number> {
  try {
    // Only the exit code matters; unread pipes can block git once it writes
    // enough diagnostic output to fill them.
    const proc = Bun.spawn(["git", ...args], {
      stdout: "ignore",
      stderr: "ignore",
      env: { ...Bun.env },
    });
    return await proc.exited;
  } catch {
    return 1;
  }
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
  const writes = [
    ["config", "--global", "--replace-all", HELPER_KEY, ""],
    ["config", "--global", "--add", HELPER_KEY, helperCommand()],
  ];
  /* oxlint-disable no-await-in-loop -- the reset must land before the add */
  for (const args of writes) {
    if ((await git(args)) !== 0) return false;
  }
  /* oxlint-enable no-await-in-loop */

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
