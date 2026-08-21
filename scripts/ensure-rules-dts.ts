// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Prepares the inputs `tsc --build` reads, so a typecheck reflects the tree it
 * runs against. Two stale-input hazards, both silent: `.archgate/rules.d.ts`
 * is gitignored and written only by `archgate check` (which `validate` runs
 * after `lint`), and `.tsbuildinfo` is keyed on sources and tsconfig, never on
 * installed `@types/*`.
 */

import { join } from "node:path";

import { z } from "zod";

import { ensureRulesShim } from "../src/helpers/rules-shim";

const projectRoot = join(import.meta.dir, "..");

/** Only the field this script reads; the rest of tsconfig passes through. */
const TsconfigSchema = z.object({
  compilerOptions: z.object({ outDir: z.string().optional() }).optional(),
});

/**
 * Drop the incremental build cache when the dependency tree moved under it.
 * `bun.lock` is the signal: it changes on every install, the only way
 * `@types/*` can change. The cost is one full rebuild per install; the cache
 * can otherwise withhold a real error as readily as report a fixed one.
 */
async function invalidateStaleBuildInfo(): Promise<void> {
  const lock = Bun.file(join(projectRoot, "bun.lock"));
  if (!(await lock.exists())) return;

  // Read outDir rather than hardcoding it, so moving it in tsconfig cannot
  // silently reinstate the stale cache. tsconfig.json permits comments.
  const tsconfig = Bun.file(join(projectRoot, "tsconfig.json"));
  if (!(await tsconfig.exists())) return;

  let outDir: string;
  try {
    const parsed = TsconfigSchema.safeParse(
      Bun.JSONC.parse(await tsconfig.text())
    );
    outDir = parsed.success
      ? (parsed.data.compilerOptions?.outDir ?? ".")
      : ".";
  } catch {
    return;
  }

  const buildInfo = Bun.file(join(projectRoot, outDir, "tsconfig.tsbuildinfo"));
  if (!(await buildInfo.exists())) return;

  if (lock.lastModified > buildInfo.lastModified) await buildInfo.delete();
}

await invalidateStaleBuildInfo();
await ensureRulesShim(projectRoot);
