import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

import { logDebug } from "./log";
import { isWindows } from "./platform";

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
 * Opencode loads per-user agents from a platform-specific config directory:
 * - Windows: `%APPDATA%\opencode\agents` (fallback: `<home>/AppData/Roaming/opencode/agents`)
 * - Linux/macOS: `$XDG_CONFIG_HOME/opencode/agents` (fallback: `<home>/.config/opencode/agents`)
 *
 * The path is resolved at call time, not cached — tests override `HOME` /
 * `APPDATA` per-test and expect the helper to pick up the override.
 */
export function opencodeAgentsDir(): string {
  const home = archgateHomeDir();

  if (isWindows()) {
    const appData = usableEnv(Bun.env.APPDATA);
    const base = appData ?? join(home, "AppData", "Roaming");
    return join(base, "opencode", "agents");
  }

  const xdg = usableEnv(Bun.env.XDG_CONFIG_HOME);
  const base = xdg ?? join(home, ".config");
  return join(base, "opencode", "agents");
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
