// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { parseModule } from "meriyah";

/** ESTree Program produced by meriyah's `parseModule`. */
export type EsTreeProgram = ReturnType<typeof parseModule>;

/**
 * Parse JavaScript module source into an ESTree AST via meriyah.
 *
 * This is the single sanctioned `parseModule()` call site, shared by the
 * rule-file sandbox scanner (`rule-scanner.ts`) and the `ctx.ast()`
 * TypeScript/JavaScript branch in `runner.ts` — per ARCH-022, the parse
 * call must not be duplicated inline at each consumer.
 *
 * Throws on syntax errors; callers decide how to surface them.
 */
export function parseJsModule(
  source: string,
  options?: { jsx?: boolean }
): EsTreeProgram {
  return parseModule(source, {
    next: true,
    loc: true,
    module: true,
    ...(options?.jsx ? { jsx: true } : {}),
  });
}
