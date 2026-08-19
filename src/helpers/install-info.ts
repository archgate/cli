// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * install-info.ts — Detects the CLI installation method and project context.
 *
 * Shared across telemetry, sentry, doctor, and other modules that need
 * to know how archgate was installed or whether a project exists.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { internalPath } from "./paths";
import { resolvedProjectPaths } from "./project-config";

// ---------------------------------------------------------------------------
// Executable resolution
// ---------------------------------------------------------------------------

/**
 * Virtual filesystem roots Bun serves a compiled binary's bundled entry from:
 * `/$bunfs/` on Linux and macOS, `B:/~BUN/` on Windows. No on-disk script
 * occupies either, so a `Bun.main` under one identifies a standalone build.
 */
const BUNFS_ROOTS = ["/$bunfs/", "b:/~bun/"];

/**
 * True when archgate runs as a compiled standalone binary, where
 * `process.execPath` is the archgate executable rather than the bun runtime.
 */
function isCompiledBinary(): boolean {
  const main = Bun.main.replaceAll("\\", "/").toLowerCase();
  return BUNFS_ROOTS.some((root) => main.startsWith(root));
}

/**
 * The path to the archgate executable or entry script.
 *
 * @returns `process.execPath` for a compiled binary, `Bun.main` under the bun
 * runtime (`bun run src/cli.ts`, `bunx archgate`).
 */
export function archgatePath(): string {
  return isCompiledBinary() ? process.execPath : Bun.main;
}

/**
 * Build the argv for re-invoking this CLI as a subprocess. Never use
 * `process.argv[0]`: a compiled binary reports the literal string `"bun"`
 * there, which is unspawnable without Bun installed.
 */
export function selfInvokeArgv(args: string[]): string[] {
  return isCompiledBinary()
    ? [process.execPath, ...args]
    : [process.execPath, Bun.main, ...args];
}

// ---------------------------------------------------------------------------
// Install method detection (cached)
// ---------------------------------------------------------------------------

/**
 * How archgate reached this machine. Distinct from `upgrade.ts`'s same-named
 * type, which carries the command needed to perform an upgrade; this one only
 * names the source.
 */
export type InstallMethod = "binary" | "proto" | "local" | "global-pm";

let cachedInstallMethod: InstallMethod | null = null;

/**
 * Detect how archgate was installed by classifying {@link archgatePath}.
 */
export function detectInstallMethod(): InstallMethod {
  if (cachedInstallMethod !== null) return cachedInstallMethod;

  const selfPath = archgatePath();

  const binDir = internalPath("bin");
  if (selfPath.startsWith(binDir)) {
    cachedInstallMethod = "binary";
    return cachedInstallMethod;
  }

  const home = Bun.env.HOME ?? Bun.env.USERPROFILE ?? "~";
  const protoHome = Bun.env.PROTO_HOME ?? join(home, ".proto");
  if (selfPath.startsWith(join(protoHome, "tools", "archgate"))) {
    cachedInstallMethod = "proto";
    return cachedInstallMethod;
  }

  if (selfPath.includes("node_modules")) {
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
 * Scan the current working directory for an archgate project. Deliberately
 * uncached: a per-process cache goes stale when the first call precedes
 * `archgate init` (the Commander `preAction` hook), making later events
 * report `has_project=false`. The read is a single `readdirSync` — cheap
 * enough to re-run on every event.
 */
export function getProjectContext(): ProjectContext {
  const cwd = process.cwd();
  const archgateDir = join(cwd, ".archgate");
  const hasProject = existsSync(archgateDir);

  if (!hasProject) {
    return {
      hasProject: false,
      adrCount: 0,
      adrWithRulesCount: 0,
      domains: [],
    };
  }

  // Use resolved paths so we scan the configured ADR directory,
  // not just the default `.archgate/adrs/`.
  const { adrsDir } = resolvedProjectPaths(cwd);

  if (!existsSync(adrsDir)) {
    return { hasProject: true, adrCount: 0, adrWithRulesCount: 0, domains: [] };
  }

  try {
    const entries = readdirSync(adrsDir);
    const mdFiles = entries.filter((f) => f.endsWith(".md"));
    const rulesFiles = entries.filter((f) => f.endsWith(".rules.ts"));

    const domainSet = new Set<string>();
    for (const f of mdFiles) {
      const match = /^([A-Z]+)-\d+/u.exec(f);
      if (match) domainSet.add(match[1]);
    }

    return {
      hasProject: true,
      adrCount: mdFiles.length,
      adrWithRulesCount: rulesFiles.length,
      domains: Array.from(domainSet).sort(),
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
