// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Resolution for the opt-in "contained relative import" feature.
 *
 * `.rules.ts` files may, when a project opts in via `ruleImports.allowedDirs`,
 * import shared helpers by relative path — but ONLY when the resolved target
 * lands inside a configured directory (each of which is itself proven to live
 * inside `.archgate/`; see `resolveRuleImportDirs`). Everything else stays
 * blocked exactly as before.
 *
 * The crux of the security model here is `realpathSync`: a specifier is
 * resolved to a concrete file, then canonicalized, then checked for
 * containment. A `..` escape or a symlink whose target sits outside the
 * allowed tree canonicalizes to its true location and fails the check, so the
 * boundary cannot be tricked by either.
 */
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { isPathInside } from "../helpers/paths";

/**
 * Extension and index candidates tried for an extensionless specifier, in the
 * order a Node/Bun resolver would consult them. Kept intentionally small: rule
 * files and their helpers are TypeScript/JavaScript source only.
 */
const RESOLVE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

/** A relative specifier is one that starts with `./` or `../`. */
export function isRelativeSpecifier(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Apply extension/index resolution to a bare (possibly extensionless) target
 * path. Returns the first existing file, or null. Mirrors the runtime: an
 * explicit path wins, then `<target><ext>`, then `<target>/index<ext>`.
 */
function resolveToFile(target: string): string | null {
  if (isFile(target)) return target;
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = target + ext;
    if (isFile(candidate)) return candidate;
  }
  if (existsSync(target)) {
    for (const ext of RESOLVE_EXTENSIONS) {
      const candidate = resolve(target, `index${ext}`);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Resolve a relative import `spec` from `fromFile` and return its canonical
 * (realpath'd) absolute path IF AND ONLY IF the target exists and lands inside
 * one of `allowedDirs` (absolute, already realpath'd, and — by construction —
 * inside `.archgate/`). Returns null when the specifier does not exist or
 * escapes containment; the caller then emits the normal blocked-import
 * violation.
 */
export function resolveContainedImport(
  spec: string,
  fromFile: string,
  allowedDirs: string[]
): string | null {
  if (allowedDirs.length === 0) return null;
  const target = resolve(dirname(fromFile), spec);
  const file = resolveToFile(target);
  if (file === null) return null;

  let real: string;
  try {
    real = realpathSync(file);
  } catch {
    return null;
  }
  return allowedDirs.some((dir) => isPathInside(real, dir)) ? real : null;
}
