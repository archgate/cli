// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Regenerates the gitignored `.archgate/rules.d.ts` ambient types shim
 * before linting, so a fresh checkout's `ctx.*` accesses in
 * `.archgate/adrs/*.rules.ts` type-check instead of resolving to `any`
 * (the shim otherwise only gets written by `archgate check`, which
 * `bun run validate` runs after `lint`).
 */

import { join } from "node:path";

import { ensureRulesShim } from "../src/helpers/rules-shim";

const projectRoot = join(import.meta.dir, "..");

await ensureRulesShim(projectRoot);
