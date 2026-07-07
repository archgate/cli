// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { parseModule, parseScript } from "meriyah";

/**
 * ESTree Program produced by meriyah's `parseModule`/`parseScript` — the
 * parser's own richly-typed return. Distinct from the hand-authored,
 * self-contained `EsTreeProgram` in `src/formats/rules.ts`, which is the
 * public shape `.rules.ts` authors see through the ambient `rules.d.ts`.
 */
export type MeriyahProgram = ReturnType<typeof parseModule>;

/**
 * Parse JavaScript source into an ESTree AST via meriyah.
 *
 * This is the single sanctioned meriyah call site, shared by the rule-file
 * sandbox scanner (`rule-scanner.ts`) and the `ctx.ast()`
 * TypeScript/JavaScript branch in `runner.ts` — per ARCH-022, the parse
 * call must not be duplicated inline at each consumer.
 *
 * `sourceType: "script"` parses sloppy-mode CommonJS (used for `.cjs`
 * files, which cannot legally contain import/export in Node). It enables
 * `globalReturn` because Node allows top-level `return` in CJS modules.
 *
 * Throws on syntax errors; callers decide how to surface them.
 */
export function parseJsModule(
  source: string,
  options?: { jsx?: boolean; sourceType?: "module" | "script" }
): MeriyahProgram {
  const jsx = options?.jsx === true;
  if (options?.sourceType === "script") {
    return parseScript(source, {
      next: true,
      loc: true,
      globalReturn: true,
      jsx,
    });
  }
  return parseModule(source, { next: true, loc: true, module: true, jsx });
}
