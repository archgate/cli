/**
 * install-info.ts — Detects the CLI installation method and project context.
 *
 * Shared across telemetry, sentry, doctor, and other modules that need
 * to know how archgate was installed or whether a project exists.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { internalPath } from "./paths";

// ---------------------------------------------------------------------------
// Install method detection (cached)
// ---------------------------------------------------------------------------

let cachedInstallMethod: string | null = null;

/**
 * Detect how archgate was installed.
 * Returns: "binary" | "proto" | "local" | "global-pm"
 *
 * Uses process.execPath for compiled binaries and Bun.main for `bun run`
 * development mode (where process.execPath is the bun runtime, not archgate).
 */
export function detectInstallMethod(): string {
  if (cachedInstallMethod) return cachedInstallMethod;

  // Compiled binary: process.execPath IS archgate (doesn't contain "bun")
  // Dev mode: process.execPath is the bun runtime, Bun.main is the script
  const archgatePath = process.execPath.includes("bun")
    ? Bun.main
    : process.execPath;

  const binDir = internalPath("bin");
  if (archgatePath.startsWith(binDir)) {
    cachedInstallMethod = "binary";
    return cachedInstallMethod;
  }

  const home = Bun.env.HOME ?? Bun.env.USERPROFILE ?? "~";
  const protoHome = Bun.env.PROTO_HOME ?? join(home, ".proto");
  if (archgatePath.startsWith(join(protoHome, "tools", "archgate"))) {
    cachedInstallMethod = "proto";
    return cachedInstallMethod;
  }

  if (archgatePath.includes("node_modules")) {
    cachedInstallMethod = "local";
    return cachedInstallMethod;
  }

  cachedInstallMethod = "global-pm";
  return cachedInstallMethod;
}

// ---------------------------------------------------------------------------
// Project context
// ---------------------------------------------------------------------------

export interface ProjectContext {
  hasProject: boolean;
  adrCount: number;
  adrWithRulesCount: number;
  domains: string[];
}

/**
 * Scan the current working directory for an archgate project.
 *
 * This used to be cached per process, but the cache was a source of stale
 * data: if the first call happened BEFORE `archgate init` created the project
 * (during the Commander `preAction` hook), the post-init `init_completed`
 * event reused the pre-init snapshot and incorrectly reported
 * `has_project=false, adr_count=0`. The read is a single `readdirSync` —
 * cheap enough to re-run on every event, and worth it for accuracy.
 */
export function getProjectContext(): ProjectContext {
  const adrsDir = join(process.cwd(), ".archgate", "adrs");
  const hasProject = existsSync(adrsDir);

  if (!hasProject) {
    return {
      hasProject: false,
      adrCount: 0,
      adrWithRulesCount: 0,
      domains: [],
    };
  }

  try {
    const entries = readdirSync(adrsDir);
    const mdFiles = entries.filter((f) => f.endsWith(".md"));
    const rulesFiles = entries.filter((f) => f.endsWith(".rules.ts"));

    const domainSet = new Set<string>();
    for (const f of mdFiles) {
      const match = f.match(/^([A-Z]+)-\d+/u);
      if (match) domainSet.add(match[1]);
    }

    return {
      hasProject: true,
      adrCount: mdFiles.length,
      adrWithRulesCount: rulesFiles.length,
      domains: [...domainSet].sort(),
    };
  } catch {
    return { hasProject: true, adrCount: 0, adrWithRulesCount: 0, domains: [] };
  }
}

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/** Reset all caches. For testing only. */
export function _resetInstallInfoCaches(): void {
  cachedInstallMethod = null;
}
