// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Prepares the inputs `tsc --build` reads, so a typecheck reflects the tree it
 * runs against. Two stale-input hazards, both silent: `.archgate/rules.d.ts`
 * is gitignored and written only by `archgate check` (which `validate` runs
 * after `lint`), and `.tsbuildinfo` is keyed on sources and tsconfig, never on
 * installed `@types/*`.
 */

import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { ensureRulesShim } from "../src/helpers/rules-shim";

const projectRoot = join(import.meta.dir, "..");

/**
 * Drop the incremental build cache when the dependency tree moved under it.
 * `bun.lock` is the signal: it changes on every install, the only way
 * `@types/*` can change. The cost is one full rebuild per install; the cache
 * can otherwise withhold a real error as readily as report a fixed one.
 */
function invalidateStaleBuildInfo(): void {
  const lockPath = join(projectRoot, "bun.lock");
  if (!existsSync(lockPath)) return;

  // Read outDir rather than hardcoding it, so moving it in tsconfig cannot
  // silently reinstate the stale cache. tsconfig.json permits comments.
  const tsconfigPath = join(projectRoot, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return;

  let outDir: string;
  try {
    outDir = resolveOutDir(Bun.JSONC.parse(readFileSync(tsconfigPath, "utf8")));
  } catch {
    return;
  }

  const buildInfo = join(projectRoot, outDir, "tsconfig.tsbuildinfo");
  if (!existsSync(buildInfo)) return;

  if (statSync(lockPath).mtimeMs > statSync(buildInfo).mtimeMs) {
    rmSync(buildInfo, { force: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Pull `compilerOptions.outDir`, defaulting to the project root. */
function resolveOutDir(parsed: unknown): string {
  if (!isRecord(parsed)) return ".";
  const options = parsed.compilerOptions;
  if (!isRecord(options)) return ".";
  return typeof options.outDir === "string" ? options.outDir : ".";
}

invalidateStaleBuildInfo();
await ensureRulesShim(projectRoot);
