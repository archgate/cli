// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Bun macro that inlines the text of `src/formats/rules.ts` at bundle time, so
 * the compiled binary carries the real interface for `generateRulesDts()` to
 * derive the ambient `rules.d.ts` shim from. Reads synchronously because an
 * async macro fails to parse under `bun build --compile --bytecode`.
 *
 * @returns Full source text of `src/formats/rules.ts`.
 * @see ARCH-022
 */
export function rulesSourceText(): string {
  return readFileSync(
    join(import.meta.dir, "..", "formats", "rules.ts"),
    "utf8"
  );
}
