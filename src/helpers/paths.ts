import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

import { logDebug } from "./log";

export function internalPath(...path: string[]) {
  const internalFolder = join(
    process.env.HOME ?? process.env.USERPROFILE ?? "~",
    ".archgate"
  );
  return join(internalFolder, ...path);
}

export const paths = {
  // TODO: this must follow the git tags matching the CLI version
  templatesRemoteArchive:
    "https://github.com/archgate/templates/archive/refs/heads/main.zip",
  cacheFolder: internalPath("cache"),
  templatesZipFile: internalPath("cache", "templates.zip"),
  templatesUnzippedFolder: internalPath("cache", "templates-main"),
  template: (name: string) => internalPath("cache", "templates-main", name),
} as const;

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
