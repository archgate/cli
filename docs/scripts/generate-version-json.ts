/**
 * Generates `public/version.json` so the install scripts can resolve the
 * latest release without hitting the GitHub API (which has aggressive
 * unauthenticated rate limits).
 *
 * The version is read from the root `package.json` — ARCH-013 already
 * enforces that `docs/astro.config.mjs` stays in sync, so this is the
 * single source of truth.
 *
 * Run automatically before `astro build` or manually:
 *
 *   bun run docs/scripts/generate-version-json.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const rootPkgPath = join(import.meta.dirname, "..", "..", "package.json");
const outputPath = join(import.meta.dirname, "..", "public", "version.json");

const pkg = JSON.parse(readFileSync(rootPkgPath, "utf-8")) as {
  version: string;
};

const payload = `{ "version": "v${pkg.version}" }\n`;
writeFileSync(outputPath, payload, "utf-8");
console.log(`Generated version.json: v${pkg.version}`);
