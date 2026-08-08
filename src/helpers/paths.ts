// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";

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
export function usableEnv(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value === "undefined") return null;
  return value;
}

/**
 * Resolve the opencode user-scope config directory (`~/.config/opencode/`).
 * Mirrors opencode's own `xdg-basedir` resolution: `$XDG_CONFIG_HOME` when
 * set, else `~/.config` on ALL platforms — including Windows (never
 * `%APPDATA%`; see CLAUDE.md "Adding a New Editor Target"). Resolved at
 * call time, not cached, so tests can override HOME / XDG_CONFIG_HOME.
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
 * Resolve the GitHub Copilot user-scope config directory, shared by the
 * `copilot` CLI and the desktop app (which ships no CLI binary). Honors
 * Copilot's `COPILOT_HOME` override, defaulting to `~/.copilot/`. Resolved
 * at call time so tests can override COPILOT_HOME / HOME.
 */
export function copilotConfigDir(): string {
  const override = usableEnv(Bun.env.COPILOT_HOME);
  if (override !== null) return override;
  return join(archgateHomeDir(), ".copilot");
}

/**
 * Resolve the Copilot session-state directory.
 *
 * Copilot stores session data (workspace.yaml + events.jsonl) under
 * `~/.copilot/session-state/<session-uuid>/`. Each session directory
 * contains a `workspace.yaml` with a `cwd` field for project matching.
 */
export function copilotSessionStateDir(): string {
  return join(copilotConfigDir(), "session-state");
}

/**
 * Resolve the opencode SQLite database path — session/message/part data at
 * `$XDG_DATA_HOME/opencode/opencode.db` (default
 * `~/.local/share/opencode/opencode.db`). Resolved at call time (not
 * cached) so tests can override HOME / XDG_DATA_HOME.
 */
export function opencodeDbPath(): string {
  const xdg = usableEnv(Bun.env.XDG_DATA_HOME);
  const base = xdg ?? join(archgateHomeDir(), ".local", "share");
  return join(base, "opencode", "opencode.db");
}

/**
 * Resolve the Codex home directory, honoring `CODEX_HOME` and defaulting to
 * `~/.codex/`. Shared by the Codex CLI and the desktop/IDE app, which both
 * resolve it through the same helper.
 */
export function codexHomeDir(): string {
  const override = usableEnv(Bun.env.CODEX_HOME);
  if (override !== null) return override;
  return join(archgateHomeDir(), ".codex");
}

/**
 * Resolve the Codex rollout directory. Sessions live under date shards
 * (`sessions/YYYY/MM/DD/`); `archived_sessions/` is a sibling tree that
 * `session-context` does not read.
 */
export function codexSessionsDir(): string {
  return join(codexHomeDir(), "sessions");
}

/**
 * Resolve the Pi agent directory, honoring `PI_CODING_AGENT_DIR` and
 * defaulting to `~/.pi/agent/`.
 */
export function piAgentDir(): string {
  const override = usableEnv(Bun.env.PI_CODING_AGENT_DIR);
  if (override !== null) return override;
  return join(archgateHomeDir(), ".pi", "agent");
}

/**
 * Resolve the Pi session directory. `PI_CODING_AGENT_SESSION_DIR` relocates
 * sessions independently of the agent directory, matching Pi's own
 * precedence.
 */
export function piSessionsDir(): string {
  const override = usableEnv(Bun.env.PI_CODING_AGENT_SESSION_DIR);
  if (override !== null) return override;
  return join(piAgentDir(), "sessions");
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
 * Walk up to the nearest directory containing `.archgate/adrs/` or
 * `.archgate/lint/` (both created by `archgate init`). Matching `.archgate/`
 * or `.archgate/config.json` alone would false-positive on the user-level
 * `~/.archgate/` cache.
 *
 * @param startDir - Directory to start the walk from. Defaults to `cwd`.
 * @returns The project root, or `null` when the walk reaches the filesystem
 * root or the `ARCHGATE_PROJECT_CEILING` bound without a match. That ceiling
 * isolates tests the way git's ceiling dirs do, and is itself still checked.
 */
/** Ancestor directories to walk before giving up — far beyond any real filesystem's nesting depth, just a hard stop against a pathological `dirname` result. */
const MAX_ANCESTOR_DEPTH = 1000;

export function findProjectRoot(startDir?: string): string | null {
  const ceilingEnv = Bun.env.ARCHGATE_PROJECT_CEILING;
  const ceiling =
    ceilingEnv !== undefined && ceilingEnv !== "" ? resolve(ceilingEnv) : null;
  let dir = startDir ?? process.cwd();

  for (let i = 0; i < MAX_ANCESTOR_DEPTH; i++) {
    const adrsDir = join(dir, ".archgate", "adrs");
    const lintDir = join(dir, ".archgate", "lint");
    if (existsSync(adrsDir) || existsSync(lintDir)) {
      return dir;
    }

    if (ceiling !== null && resolve(dir) === ceiling) {
      return null;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
  return null;
}

/**
 * Resolve the project root for commands that require one.
 *
 * @param startDir - Directory to start the walk from. Defaults to `cwd`.
 * @returns The project root directory.
 * @throws {UserError} When no project is found. The ARCH-012 boundary
 * (`handleCommandError`) logs it and exits 1 without Sentry.
 * @see {@link findProjectRoot} — used directly by commands that can operate
 * without a project, such as `session-context` falling back to cwd.
 */
export function requireProjectRoot(startDir?: string): string {
  const projectRoot = findProjectRoot(startDir);
  if (projectRoot === null || projectRoot === "") {
    throw new UserError(
      "No .archgate/ directory found.",
      "Run `archgate init` first."
    );
  }
  return projectRoot;
}
