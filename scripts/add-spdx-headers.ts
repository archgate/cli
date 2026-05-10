// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * add-spdx-headers.ts — One-time script to add SPDX license headers to all
 * TypeScript source files that don't already have them.
 *
 * Run: bun run scripts/add-spdx-headers.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Glob } from "bun";

const HEADER = `// SPDX-License-Identifier: Apache-2.0\n// Copyright 2026 Archgate\n`;
const ROOT = join(import.meta.dir, "..");

const patterns = ["src/**/*.ts", "tests/**/*.ts"];
let updated = 0;
let skipped = 0;

for (const pattern of patterns) {
  const glob = new Glob(pattern);
  for (const match of glob.scanSync({ cwd: ROOT, absolute: true })) {
    const content = readFileSync(match, "utf-8");

    // Skip if already has SPDX header
    if (content.includes("SPDX-License-Identifier")) {
      skipped++;
      continue;
    }

    // Handle shebang lines — insert after them
    let newContent: string;
    if (content.startsWith("#!")) {
      const firstNewline = content.indexOf("\n");
      newContent =
        content.slice(0, firstNewline + 1) +
        HEADER +
        content.slice(firstNewline + 1);
    } else {
      newContent = HEADER + content;
    }

    writeFileSync(match, newContent);
    updated++;
  }
}

console.log(
  `Added SPDX headers to ${updated} files. Skipped ${skipped} (already had headers).`
);
