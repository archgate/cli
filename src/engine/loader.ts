import { readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { parseAdr } from "../formats/adr";
import type { AdrDocument } from "../formats/adr";
import { type RuleSet } from "../formats/rules";
import { z } from "zod";
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
import { projectPaths } from "../helpers/paths";
import { logDebug, logWarn } from "../helpers/log";

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
  const loaded: LoadedAdr[] = [];

  const adrDirs: string[] = [pp.adrsDir];

  for (const adrsDir of adrDirs) {
    let files: string[];
    try {
      files = readdirSync(adrsDir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = join(adrsDir, file);
      let adr: AdrDocument;

      try {
        // oxlint-disable-next-line no-await-in-loop -- sequential file discovery is intentional
        const content = await Bun.file(filePath).text();
        adr = parseAdr(content, filePath);
      } catch (err) {
        logDebug(`Skipping unparseable ADR: ${filePath}`, err);
        continue;
      }

      // Skip if no rules
      if (!adr.frontmatter.rules) {
        continue;
      }

      // Filter by specific ADR ID if requested
      if (filterAdrId && adr.frontmatter.id !== filterAdrId) {
        continue;
      }

      // Find companion .rules.ts file
      const baseName = basename(file, ".md");
      const rulesFile = join(adrsDir, `${baseName}.rules.ts`);
      // oxlint-disable-next-line no-await-in-loop -- sequential file discovery is intentional
      const rulesFileExists = await Bun.file(rulesFile).exists();

      if (!rulesFileExists) {
        logWarn(
          `ADR ${adr.frontmatter.id} has rules: true but no companion file found: ${rulesFile}`
        );
        continue;
      }

      try {
        // Cache-bust: Bun caches import() per-process, so append a timestamp
        // to force re-reading from disk on every call (critical for MCP server).
        // Use file:// URL to handle Windows backslash paths in import().
        const rulesUrl = `${pathToFileURL(rulesFile).href}?t=${Date.now()}`;
        // oxlint-disable-next-line no-await-in-loop -- dynamic import must be sequential
        const mod = await import(rulesUrl);
        const parsed = RuleSetSchema.safeParse(mod.default);

        if (!parsed.success) {
          logWarn(
            `ADR ${adr.frontmatter.id}: companion file does not export a valid RuleSet as default`
          );
          continue;
        }

        const ruleSet: RuleSet = parsed.data;
        loaded.push({ adr, ruleSet });
        logDebug(
          `Loaded ${Object.keys(ruleSet.rules).length} rules from ${adr.frontmatter.id}`
        );
      } catch (err) {
        logWarn(`Failed to import rules for ${adr.frontmatter.id}: ${err}`);
      }
    }
  }

  return loaded;
}
