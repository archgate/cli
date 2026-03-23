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
import { relative } from "node:path";

import type { ViolationDetail } from "../formats/rules";
import { logDebug } from "../helpers/log";
import { projectPaths } from "../helpers/paths";
import { ensureRulesShim } from "../helpers/rules-shim";
import { scanRuleSource } from "./rule-scanner";

export interface LoadedAdr {
  adr: AdrDocument;
  ruleSet: RuleSet;
}

export interface BlockedAdr {
  adr: AdrDocument;
  error: string;
  violations: Array<{
    message: string;
    file: string;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
  }>;
}

export type LoadResult =
  | { type: "loaded"; value: LoadedAdr }
  | { type: "blocked"; value: BlockedAdr };

/** Convert a BlockedAdr into a RuleResult-shaped object for reporting. */
export function blockedToRuleResult(projectRoot: string, b: BlockedAdr) {
  const id = b.adr.frontmatter.id;
  const isSyntax = b.error.includes("syntax convention");
  const ruleId = isSyntax ? "syntax-check" : "security-scan";
  const description = isSyntax
    ? "Rule file syntax conventions"
    : "Rule file security scan";
  return {
    ruleId,
    adrId: id,
    description,
    violations: b.violations.map(
      (v): ViolationDetail => ({
        message: v.message,
        file: relative(projectRoot, v.file).replaceAll("\\", "/"),
        line: v.line,
        endLine: v.endLine,
        endColumn: v.endColumn,
        severity: "error",
        adrId: id,
        ruleId,
      })
    ),
    error: b.error,
    durationMs: 0,
  };
}

interface SyntaxViolation {
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

/**
 * Check that a `.rules.ts` file follows the required syntax conventions:
 * 1. Triple-slash reference directive: `/// <reference path="..." />`
 *    pointing to `rules.d.ts` (provides ambient types without imports).
 * 2. `satisfies RuleSet` on the default export (compile-time validation).
 *
 * These are authoring conventions that ensure rule files get proper
 * type-checking and remain self-documenting.
 */
function checkRuleSyntax(source: string): SyntaxViolation[] {
  const violations: SyntaxViolation[] = [];

  // Check for triple-slash reference to rules.d.ts
  const hasTripleSlash =
    /^\/\/\/\s*<reference\s+path=["'][^"']*rules\.d\.ts["']\s*\/>$/m.test(
      source
    );
  if (!hasTripleSlash) {
    violations.push({
      message:
        'Missing triple-slash reference directive. Add /// <reference path="../rules.d.ts" /> at the top of the file.',
      line: 1,
      column: 0,
      endLine: 1,
      endColumn:
        source.indexOf("\n") === -1 ? source.length : source.indexOf("\n"),
    });
  }

  // Check for `satisfies RuleSet` on the default export
  const hasSatisfies = /\bsatisfies\s+RuleSet\b/.test(source);
  if (!hasSatisfies) {
    // Point to the last line as a reasonable location for the missing satisfies
    const lines = source.split("\n");
    const lastLine = lines.length;
    violations.push({
      message:
        "Missing `satisfies RuleSet` on default export. The export must use `} satisfies RuleSet;` for compile-time type validation.",
      line: lastLine,
      column: 0,
      endLine: lastLine,
      endColumn: lines[lastLine - 1]?.length ?? 0,
    });
  }

  return violations;
}

/**
 * Discover ADRs with rules: true and dynamically import their companion .rules.ts files.
 */
export async function loadRuleAdrs(
  projectRoot: string,
  filterAdrId?: string
): Promise<LoadResult[]> {
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
    ruleAdrs.map(async ({ file, adr }): Promise<LoadResult> => {
      const baseName = basename(file, ".md");
      const rulesFile = join(adrsDir, `${baseName}.rules.ts`);
      const rulesFileExists = await Bun.file(rulesFile).exists();

      if (!rulesFileExists) {
        // Find the "rules: true" line in the ADR file for precise highlighting
        const adrPath = join(adrsDir, file);
        const adrContent = await Bun.file(adrPath).text();
        const adrLines = adrContent.split("\n");
        let rulesLine = 1;
        let rulesEndCol = 0;
        for (let i = 0; i < adrLines.length; i++) {
          const match = adrLines[i].match(/^rules:\s*true/);
          if (match) {
            rulesLine = i + 1;
            rulesEndCol = adrLines[i].length;
            break;
          }
        }
        return {
          type: "blocked",
          value: {
            adr,
            error: `ADR ${adr.frontmatter.id} has rules: true but no companion file found`,
            violations: [
              {
                message: `No companion .rules.ts file found. Create ${baseName}.rules.ts or set rules: false.`,
                file: adrPath,
                line: rulesLine,
                column: 0,
                endLine: rulesLine,
                endColumn: rulesEndCol,
              },
            ],
          },
        };
      }

      const ruleSource = await Bun.file(rulesFile).text();

      // Syntax gate: ensure rule files follow the required conventions
      // (triple-slash reference directive + `satisfies RuleSet`).
      const syntaxViolations = checkRuleSyntax(ruleSource);
      if (syntaxViolations.length > 0) {
        return {
          type: "blocked",
          value: {
            adr,
            error: `ADR ${adr.frontmatter.id}: rule file has syntax convention violations (${syntaxViolations.length} violation${syntaxViolations.length === 1 ? "" : "s"})`,
            violations: syntaxViolations.map((v) => ({
              message: v.message,
              file: rulesFile,
              line: v.line,
              column: v.column,
              endLine: v.endLine,
              endColumn: v.endColumn,
            })),
          },
        };
      }

      // Security gate: scan rule source for banned patterns before executing.
      // This blocks dangerous imports (node:fs, child_process), Bun APIs
      // (Bun.spawn, Bun.file), network access (fetch), eval, and obfuscation
      // patterns (computed property access, dynamic imports).
      const scanViolations = scanRuleSource(ruleSource);
      if (scanViolations.length > 0) {
        return {
          type: "blocked",
          value: {
            adr,
            error: `ADR ${adr.frontmatter.id}: rule file blocked by security scanner (${scanViolations.length} violation${scanViolations.length === 1 ? "" : "s"})`,
            violations: scanViolations.map((v) => ({
              message: v.message,
              file: rulesFile,
              line: v.line,
              column: v.column,
              endLine: v.endLine,
              endColumn: v.endColumn,
            })),
          },
        };
      }

      // Cache-bust: Bun caches import() per-process, so append a timestamp
      // to force re-reading from disk on every call (critical for repeated invocations).
      // Use file:// URL to handle Windows backslash paths in import().
      const rulesUrl = `${pathToFileURL(rulesFile).href}?t=${Date.now()}`;
      const mod = await import(rulesUrl);
      const parsed = RuleSetSchema.safeParse(mod.default);

      if (!parsed.success) {
        return {
          type: "blocked",
          value: {
            adr,
            error: `ADR ${adr.frontmatter.id}: companion file does not export a valid RuleSet as default`,
            violations: [],
          },
        };
      }

      const ruleSet: RuleSet = parsed.data;
      logDebug(
        `Loaded ${Object.keys(ruleSet.rules).length} rules from ${adr.frontmatter.id}`
      );
      return { type: "loaded", value: { adr, ruleSet } };
    })
  );

  return ruleResults;
}
