// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { CaseScheme } from "../formats/rules";

/**
 * Anchored ASCII pattern per casing scheme — each matches the ENTIRE string,
 * over ASCII letters and digits only. `camelCase`/`PascalCase` follow
 * typescript-eslint's `naming-convention`, so acronym runs match.
 *
 * @see CaseScheme in src/formats/rules.ts — the per-scheme contract
 */
const CASE_PATTERNS: Record<CaseScheme, RegExp> = {
  "kebab-case": /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
  camelCase: /^[a-z][a-zA-Z0-9]*$/u,
  PascalCase: /^[A-Z][a-zA-Z0-9]*$/u,
  snake_case: /^[a-z0-9]+(?:_[a-z0-9]+)*$/u,
  SCREAMING_SNAKE_CASE: /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/u,
};

/**
 * Check whether `value` conforms to a casing scheme. Pure and synchronous —
 * no I/O. The empty string matches no scheme. Throws on an unrecognized
 * scheme (rule files may pass a dynamically-built string that defeats the
 * `CaseScheme` type) rather than silently returning false, so a typo in a
 * scheme name surfaces as a rule error instead of a false pass/fail.
 */
export function checkCase(value: string, scheme: CaseScheme): boolean {
  const pattern = CASE_PATTERNS[scheme];
  if (!pattern) {
    throw new Error(
      `Unknown case scheme "${scheme}" — supported schemes: ${Object.keys(CASE_PATTERNS).join(", ")}`
    );
  }
  return pattern.test(value);
}
