// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve, sep } from "node:path";

import { logDebug } from "./log";
import { UserError } from "./user-error";

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
 * Resolve the opencode user-scope config directory (`~/.config/opencode/`).
 *
 * Opencode uses the `xdg-basedir` package to locate its config root. That
 * package reads `$XDG_CONFIG_HOME` when set and otherwise falls back to
 * `~/.config` on **all platforms** — including Windows, where the resolved
 * path is `C:\Users\<user>\.config\opencode\` rather than anything under
 * `%APPDATA%`. We mirror the same resolution here so the CLI writes to
 * the exact directory opencode reads from.
 *
 * The path is resolved at call time, not cached — tests override `HOME` /
 * `XDG_CONFIG_HOME` per-test and expect the helper to pick up the override.
 *
 * Used by `opencodeAgentsDir()` and `opencodeConfigPath()`.
 */
export function opencodeConfigDir(): string {
  const xdg = usableEnv(Bun.env.XDG_CONFIG_HOME);
  const base = xdg ?? join(archgateHomeDir(), ".config");
  return join(base, "opencode");
}

export function opencodeAgentsDir(): string {
  return join(opencodeConfigDir(), "agents");
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
 * Resolve the opencode SQLite database path.
 *
 * Opencode stores session/message/part data in a SQLite database at
 * `$XDG_DATA_HOME/opencode/opencode.db` (defaulting to
 * `~/.local/share/opencode/opencode.db`).
 *
 * Resolved at call time (not cached) so tests can override HOME /
 * XDG_DATA_HOME.
 */
export function opencodeDbPath(): string {
  const xdg = usableEnv(Bun.env.XDG_DATA_HOME);
  const base = xdg ?? join(archgateHomeDir(), ".local", "share");
  return join(base, "opencode", "opencode.db");
}

/**
 * Resolve the Cursor user-scope config directory (`~/.cursor/`).
 *
 * Cursor discovers skills and agents from `~/.cursor/{skills,agents}/`.
 * These are user-level (global) — they apply to all projects when using
 * `cursor agent` locally. Cloud VMs do NOT have this directory.
 *
 * Resolved at call time (not cached) so tests can override HOME.
 */
export function cursorUserDir(): string {
  return join(archgateHomeDir(), ".cursor");
}

export const paths = { cacheFolder: internalPath("cache") } as const;

/**
 * True when `child` is `parent` itself or a path nested inside it. Both must be
 * absolute and normalized (e.g. the output of `realpathSync`/`resolve`), so
 * that a prefix comparison is sound. Used to enforce the `.archgate/`
 * containment boundary on opt-in rule-file imports.
 */
export function isPathInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  const base = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(base);
}

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
 * Walk up from cwd to find the nearest directory containing an archgate
 * project. A directory is a project root when it has either:
 *   - `.archgate/adrs/` — standard project layout
 *   - `.archgate/lint/` — also created by `archgate init`
 *
 * Both directories are created by `archgate init` and are project-specific.
 * We cannot match on `.archgate/` alone because `~/.archgate/` is the
 * CLI's user-level cache directory (binary installs, credentials, etc.)
 * and would produce false positives. We also avoid matching on
 * `.archgate/config.json` because `~/.archgate/config.json` stores
 * telemetry settings.
 *
 * **Test isolation:** Set `ARCHGATE_PROJECT_CEILING` to a directory path
 * to prevent the walk-up from escaping above it — analogous to git's
 * `GIT_CEILING_DIRECTORIES`. The ceiling directory itself is still
 * checked, but the walk stops there.
 */
export function findProjectRoot(startDir?: string): string | null {
  const ceilingEnv = Bun.env.ARCHGATE_PROJECT_CEILING;
  const ceiling = ceilingEnv ? resolve(ceilingEnv) : null;
  let dir = startDir ?? process.cwd();

  while (true) {
    const adrsDir = join(dir, ".archgate", "adrs");
    const lintDir = join(dir, ".archgate", "lint");
    if (existsSync(adrsDir) || existsSync(lintDir)) {
      return dir;
    }

    // Don't walk above the ceiling directory
    if (ceiling && resolve(dir) === ceiling) {
      return null;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Like {@link findProjectRoot}, but throws a {@link UserError} when no
 * project is found. For command actions whose body is wrapped in the
 * ARCH-012 error boundary (handleCommandError): the boundary logs the
 * message and exits 1 without Sentry. Commands that can operate without a
 * project (e.g. `session-context` falling back to cwd) should keep using
 * `findProjectRoot()` directly.
 */
export function requireProjectRoot(startDir?: string): string {
  const projectRoot = findProjectRoot(startDir);
  if (!projectRoot) {
    throw new UserError(
      "No .archgate/ directory found.",
      "Run `archgate init` first."
    );
  }
  return projectRoot;
}
