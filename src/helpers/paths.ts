import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

import { logDebug } from "./log";

/**
 * Resolves the user home directory for ~/.archgate paths.
 * Ignores empty env and the literal string "undefined" (mis-set env / tooling bugs)
 * so path.join does not create a ./undefined/.archgate tree under cwd.
 */
function archgateHomeDir(): string {
  const fromEnv = Bun.env.HOME ?? Bun.env.USERPROFILE;
  if (
    typeof fromEnv === "string" &&
    fromEnv.length > 0 &&
    fromEnv !== "undefined"
  ) {
    return fromEnv;
  }
  return homedir();
}

export function internalPath(...path: string[]) {
  const internalFolder = join(archgateHomeDir(), ".archgate");
  return join(internalFolder, ...path);
}

/**
 * Accept an env-var value only when it is a non-empty string that isn't the
 * literal "undefined". Mirrors the defensive handling in `archgateHomeDir()`
 * — shells and tooling sometimes surface an unset variable as the string
 * "undefined", which would otherwise leak into the resolved path.
 */
function usableEnv(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value === "undefined") return null;
  return value;
}

/**
 * Resolve the opencode user-scope agents directory.
 *
 * Opencode uses the `xdg-basedir` package to locate its config root. That
 * package reads `$XDG_CONFIG_HOME` when set and otherwise falls back to
 * `~/.config` on **all platforms** — including Windows, where the resolved
 * path is `C:\Users\<user>\.config\opencode\agents` rather than anything
 * under `%APPDATA%`. We mirror the same resolution here so the CLI writes
 * to the exact directory opencode reads from.
 *
 * The path is resolved at call time, not cached — tests override `HOME` /
 * `XDG_CONFIG_HOME` per-test and expect the helper to pick up the override.
 */
export function opencodeAgentsDir(): string {
  const xdg = usableEnv(Bun.env.XDG_CONFIG_HOME);
  const base = xdg ?? join(archgateHomeDir(), ".config");
  return join(base, "opencode", "agents");
}

/**
 * Resolve the Copilot CLI session-state directory.
 *
 * Copilot CLI stores session data (workspace.yaml + events.jsonl) under
 * `~/.copilot/session-state/<session-uuid>/`. Each session directory
 * contains a `workspace.yaml` with a `cwd` field for project matching.
 *
 * Resolved at call time (not cached) so tests can override HOME.
 */
export function copilotSessionStateDir(): string {
  return join(archgateHomeDir(), ".copilot", "session-state");
}

/**
 * Resolve the opencode data storage directory.
 *
 * Opencode stores sessions, messages, and parts under
 * `$XDG_DATA_HOME/opencode/storage/` (defaulting to
 * `~/.local/share/opencode/storage/`). This is distinct from the
 * config directory (`$XDG_CONFIG_HOME/opencode/`) used by
 * `opencodeAgentsDir()`.
 *
 * Resolved at call time (not cached) so tests can override HOME /
 * XDG_DATA_HOME.
 */
export function opencodeStorageDir(): string {
  const xdg = usableEnv(Bun.env.XDG_DATA_HOME);
  const base = xdg ?? join(archgateHomeDir(), ".local", "share");
  return join(base, "opencode", "storage");
}

export const paths = { cacheFolder: internalPath("cache") } as const;

export function projectPath(projectRoot: string, ...path: string[]) {
  return join(projectRoot, ".archgate", ...path);
}

export function projectPaths(projectRoot: string) {
  return {
    root: projectPath(projectRoot),
    adrsDir: projectPath(projectRoot, "adrs"),
    lintDir: projectPath(projectRoot, "lint"),
  };
}

export function createPathIfNotExists(path: string) {
  if (existsSync(path)) {
    logDebug("Path already exists:", path);
    return;
  }
  logDebug("Creating path:", path);
  mkdirSync(path, { recursive: true });
}

/**
 * Walk up from cwd to find the nearest directory containing .archgate/adrs/.
 * Returns the project root path or null if not found.
 */
export function findProjectRoot(startDir?: string): string | null {
  let dir = startDir ?? process.cwd();

  while (true) {
    const adrsDir = join(dir, ".archgate", "adrs");
    if (existsSync(adrsDir)) {
      return dir;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
