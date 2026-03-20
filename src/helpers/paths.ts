import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

import { logDebug } from "./log";

export function internalPath(...path: string[]) {
  // Use process.env.HOME/USERPROFILE first (testable via env override),
  // fall back to os.homedir() which handles platform-specific resolution.
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  const internalFolder = join(home, ".archgate");
  return join(internalFolder, ...path);
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
