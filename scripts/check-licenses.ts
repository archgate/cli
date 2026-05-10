// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * check-licenses.ts — Verify all dependency licenses are compatible with Apache-2.0.
 *
 * Run: bun run license:check
 *
 * Scans top-level node_modules packages and checks their `license` field against
 * an allowlist of permissive licenses. Fails with exit code 1 if any package uses
 * a copyleft or unknown license.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { styleText } from "node:util";

const ALLOWED_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
  "CC-BY-3.0",
  "Python-2.0",
  "(MIT OR Apache-2.0)",
  "MIT OR Apache-2.0",
  "(MIT AND Zlib)",
  "(BSD-2-Clause OR MIT OR Apache-2.0)",
  "(MIT OR CC0-1.0)",
  "BlueOak-1.0.0 OR MIT OR Apache-2.0",
]);

/**
 * Normalize license expressions — handles SPDX expressions and common variants.
 */
function normalizeLicense(raw: string): string {
  return raw.trim().replace(/^\(/u, "").replace(/\)$/u, "");
}

function isAllowed(license: string | undefined): boolean {
  if (!license) return false;
  if (ALLOWED_LICENSES.has(license)) return true;

  // Handle OR expressions: "MIT OR Apache-2.0" — all alternatives must be allowed
  const normalized = normalizeLicense(license);
  if (ALLOWED_LICENSES.has(normalized)) return true;
  if (ALLOWED_LICENSES.has(`(${normalized})`)) return true;

  // If it's an OR expression, check if at least one option is allowed
  if (normalized.includes(" OR ")) {
    return normalized.split(" OR ").some((l) => ALLOWED_LICENSES.has(l.trim()));
  }

  return false;
}

const nodeModulesPath = join(import.meta.dir, "..", "node_modules");
const violations: { name: string; license: string | undefined }[] = [];
let scanned = 0;

const entries = readdirSync(nodeModulesPath, { withFileTypes: true });

for (const entry of entries) {
  if (!entry.isDirectory()) continue;

  // Handle scoped packages (@scope/package)
  if (entry.name.startsWith("@")) {
    const scopePath = join(nodeModulesPath, entry.name);
    const scopedEntries = readdirSync(scopePath, { withFileTypes: true });
    for (const scopedEntry of scopedEntries) {
      if (!scopedEntry.isDirectory()) continue;
      const pkgJsonPath = join(scopePath, scopedEntry.name, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      const name = `${entry.name}/${scopedEntry.name}`;
      const license = pkgJson.license;
      scanned++;
      if (!isAllowed(license)) {
        violations.push({ name, license });
      }
    }
  } else {
    // Skip hidden dirs and .package-lock.json etc.
    if (entry.name.startsWith(".")) continue;
    const pkgJsonPath = join(nodeModulesPath, entry.name, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    const license = pkgJson.license;
    scanned++;
    if (!isAllowed(license)) {
      violations.push({ name: entry.name, license });
    }
  }
}

console.log(`Scanned ${scanned} packages.`);

if (violations.length > 0) {
  console.log(
    styleText(
      "red",
      `\n${violations.length} package(s) with disallowed or missing licenses:\n`
    )
  );
  for (const v of violations) {
    console.log(
      `  ${styleText("bold", v.name)}: ${v.license ?? "(no license field)"}`
    );
  }
  console.log(
    "\nIf a license is permissive but not in the allowlist, add it to scripts/check-licenses.ts."
  );
  process.exit(1);
} else {
  console.log(
    styleText(
      "green",
      "All dependency licenses are compatible with Apache-2.0."
    )
  );
}
