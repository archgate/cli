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
