// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * git-credential-config.ts — register archgate as git's credential helper.
 *
 * Scoped to the plugins host alone, so credentials for every other host keep
 * using whatever helper the user already configured.
 */

import { selfInvokeArgv } from "./install-info";
import { logDebug, logWarn } from "./log";
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
 * Register the helper, warning rather than failing when git refuses.
 *
 * Downloads use the access token directly, so a missing helper entry costs
 * only non-interactive `git clone` of plugin repositories.
 */
export async function ensureGitCredentialHelper(): Promise<void> {
  if (await registerGitCredentialHelper()) return;
  logWarn(
    "Could not register archgate as a git credential helper.",
    "Plugin downloads still work; `git clone` of a plugin repository may prompt for credentials."
  );
}

/** What `archgate doctor` reports about the helper entry. */
export interface CredentialHelperStatus {
  /** Git consults an archgate helper entry for the plugins host. */
  registered: boolean;
  /** The entry names this executable, not one from an earlier install. */
  current: boolean;
  /** No other helper is consulted ahead of archgate. */
  exclusive: boolean;
}

/**
 * Inspect the helper entries git consults for the plugins host.
 *
 * Every scope is read in the order git consults them, since a system entry
 * ahead of archgate answers first regardless of what the global file says.
 * An empty entry discards every helper before it, so only the entries after
 * the last one count. A git that cannot start reads as nothing registered.
 */
export async function inspectGitCredentialHelper(): Promise<CredentialHelperStatus> {
  const entries = await gitConfigValues(HELPER_KEY);
  const effective = entries.slice(entries.lastIndexOf("") + 1);
  const archgateIndex = effective.findIndex((entry) =>
    entry.endsWith(" credential")
  );
  const registered = archgateIndex !== -1;
  return {
    registered,
    current: registered && effective[archgateIndex] === helperCommand(),
    exclusive: archgateIndex === 0,
  };
}

/**
 * Read every value of a multi-valued config key across all scopes, in order.
 *
 * Both streams are drained while git runs so neither can fill and block it;
 * the exit code is checked before the output is trusted. Exit code 1 means
 * the key is unset, which is an empty list rather than a failure.
 *
 * @returns The values, or an empty list when git cannot start or fails.
 */
async function gitConfigValues(key: string): Promise<string[]> {
  try {
    const proc = Bun.spawn(["git", "config", "--get-all", key], {
      stdout: "pipe",
      stderr: "ignore",
      env: { ...Bun.env },
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) return [];
    return stdout.split("\n").slice(0, -1);
  } catch {
    return [];
  }
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
