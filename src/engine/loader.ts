import { readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { parseAdr } from "../formats/adr";
import type { AdrDocument } from "../formats/adr";
import { type RuleSet } from "../formats/rules";
import type { RuleContext } from "../formats/rules";

const RuleSetSchema = z.object({
  rules: z.record(
    z.string(),
    z.object({
      description: z.string(),
      severity: z.enum(["error", "warning", "info"]).optional(),
      check: z.custom<(ctx: RuleContext) => Promise<void>>(
        (val) => typeof val === "function",
        "Expected a function"
      ),
    })
  ),
});
import { logDebug, logError } from "../helpers/log";
import { projectPaths } from "../helpers/paths";
import { ensureRulesShim } from "../helpers/rules-shim";
import { scanRuleSource } from "./rule-scanner";

export interface LoadedAdr {
  adr: AdrDocument;
  ruleSet: RuleSet;
}

/**
 * Discover ADRs with rules: true and dynamically import their companion .rules.ts files.
 */
export async function loadRuleAdrs(
  projectRoot: string,
  filterAdrId?: string
): Promise<LoadedAdr[]> {
  const pp = projectPaths(projectRoot);

  // Ensure rules.d.ts exists so .rules.ts files get type checking
  // without requiring node_modules (supports non-JS projects)
  await ensureRulesShim(projectRoot);

  const adrsDir = pp.adrsDir;

  let files: string[];
  try {
    files = readdirSync(adrsDir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }

  // Phase 1: Read and parse all ADR files in parallel
  const parsedAdrs = await Promise.all(
    files.map(async (file) => {
      const filePath = join(adrsDir, file);
      try {
        const content = await Bun.file(filePath).text();
        return { file, adr: parseAdr(content, filePath) };
      } catch (err) {
        logDebug(`Skipping unparseable ADR: ${filePath}`, err);
        return null;
      }
    })
  );

  // Filter to ADRs that have rules enabled
  const ruleAdrs = parsedAdrs.filter(
    (entry): entry is NonNullable<typeof entry> => {
      if (entry === null) return false;
      if (!entry.adr.frontmatter.rules) return false;
      if (filterAdrId && entry.adr.frontmatter.id !== filterAdrId) return false;
      return true;
    }
  );

  // Phase 2: Verify companion files exist and import rule sets in parallel
  const ruleResults = await Promise.all(
    ruleAdrs.map(async ({ file, adr }) => {
      const baseName = basename(file, ".md");
      const rulesFile = join(adrsDir, `${baseName}.rules.ts`);
      const rulesFileExists = await Bun.file(rulesFile).exists();

      if (!rulesFileExists) {
        throw new Error(
          `ADR ${adr.frontmatter.id} has rules: true but no companion file found: ${rulesFile}`
        );
      }

      // Security gate: scan rule source for banned patterns before executing.
      // This blocks dangerous imports (node:fs, child_process), Bun APIs
      // (Bun.spawn, Bun.file), network access (fetch), eval, and obfuscation
      // patterns (computed property access, dynamic imports).
      const ruleSource = await Bun.file(rulesFile).text();
      const scanViolations = scanRuleSource(ruleSource);
      if (scanViolations.length > 0) {
        for (const v of scanViolations) {
          logError(`${rulesFile}:${v.line}:${v.column} - ${v.message}`);
        }
        throw new Error(
          `ADR ${adr.frontmatter.id}: rule file blocked by security scanner (${scanViolations.length} violation${scanViolations.length === 1 ? "" : "s"})`
        );
      }

      // Cache-bust: Bun caches import() per-process, so append a timestamp
      // to force re-reading from disk on every call (critical for repeated invocations).
      // Use file:// URL to handle Windows backslash paths in import().
      const rulesUrl = `${pathToFileURL(rulesFile).href}?t=${Date.now()}`;
      const mod = await import(rulesUrl);
      const parsed = RuleSetSchema.safeParse(mod.default);

      if (!parsed.success) {
        throw new Error(
          `ADR ${adr.frontmatter.id}: companion file does not export a valid RuleSet as default`
        );
      }

      const ruleSet: RuleSet = parsed.data;
      logDebug(
        `Loaded ${Object.keys(ruleSet.rules).length} rules from ${adr.frontmatter.id}`
      );
      return { adr, ruleSet };
    })
  );

  return ruleResults.filter((r): r is LoadedAdr => r !== null);
}
