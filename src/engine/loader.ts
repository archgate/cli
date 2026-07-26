// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
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
import { resolvedProjectPaths } from "../helpers/project-config";
import { ensureRulesShim } from "../helpers/rules-shim";
import { UserError } from "../helpers/user-error";
import { scanRuleSource } from "./rule-scanner";

/** Narrow a dynamic-import namespace object before touching its keys. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Extract a Node.js errno `code` from a caught value, without an unsafe cast. */
function getErrnoCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const { code } = err;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

interface LoadedAdr {
  adr: AdrDocument;
  ruleSet: RuleSet;
}

interface BlockedAdr {
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
 * a triple-slash reference to `rules.d.ts` (ambient types without imports)
 * and a `satisfies RuleSet` clause (compile-time validation). Both are
 * presence checks over the source text, not placement checks.
 */
function checkRuleSyntax(source: string): SyntaxViolation[] {
  const violations: SyntaxViolation[] = [];

  const hasTripleSlash =
    /^\/\/\/\s*<reference\s+path=["'][^"']*rules\.d\.ts["']\s*\/>$/mu.test(
      source
    );
  if (!hasTripleSlash) {
    violations.push({
      message:
        'Missing triple-slash reference directive. Add /// <reference path="../rules.d.ts" /> at the top of the file.',
      line: 1,
      column: 0,
      endLine: 1,
      endColumn: source.includes("\n") ? source.indexOf("\n") : source.length,
    });
  }

  const hasSatisfies = /\bsatisfies\s+RuleSet\b/u.test(source);
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

interface ParsedAdrEntry {
  file: string;
  adr: AdrDocument;
}

/**
 * Process-level cache of `readdir + read + parse` per project root, so
 * briefings and rule loading share one parse pass in the same invocation.
 * Per-process lifetime is consistent with the other per-invocation caches
 * here (git ls-files, repo context, install method).
 */
const parsedAdrsCache = new Map<string, Promise<ParsedAdrEntry[]>>();

/**
 * Files in the ADR directory that could not be read or parsed, per project
 * root. Populated by the same pass that fills `parsedAdrsCache`.
 */
const skippedAdrsCache = new Map<string, string[]>();

/**
 * ADR files that were skipped during parsing, so a caller reporting on the
 * corpus can say the listing is incomplete instead of implying it is clean.
 *
 * @returns Filenames relative to the ADR directory. Call after `parseAllAdrs`.
 */
export function getSkippedAdrs(projectRoot: string): string[] {
  return skippedAdrsCache.get(projectRoot) ?? [];
}

/**
 * Read and parse every ADR markdown file in the project, caching the result
 * per-process.
 *
 * @returns Entries in directory order. Unparseable files are silently
 * skipped, logged at debug level.
 */
export async function parseAllAdrs(
  projectRoot: string
): Promise<ParsedAdrEntry[]> {
  const cached = parsedAdrsCache.get(projectRoot);
  if (cached) return cached;

  const pp = resolvedProjectPaths(projectRoot);
  const adrsDir = pp.adrsDir;

  const promise = (async () => {
    const skipped: string[] = [];
    let files: string[];
    try {
      files = readdirSync(adrsDir).filter((f) => f.endsWith(".md"));
    } catch (err) {
      // A missing directory means "no ADRs", which is a clean state. Any other
      // failure (EACCES, ENOTDIR) means the corpus was never inspected, and
      // returning silently would report that as clean.
      const code = getErrnoCode(err);
      if (code !== "ENOENT") {
        skippedAdrsCache.set(projectRoot, [
          `${adrsDir} (unreadable: ${code ?? String(err)})`,
        ]);
      }
      return [];
    }
    const parsed = await Promise.all(
      files.map(async (file): Promise<ParsedAdrEntry | null> => {
        const filePath = join(adrsDir, file);
        try {
          const content = await Bun.file(filePath).text();
          return { file, adr: parseAdr(content, filePath) };
        } catch (err) {
          logDebug(`Skipping unparseable ADR: ${filePath}`, err);
          skipped.push(file);
          return null;
        }
      })
    );

    skippedAdrsCache.set(projectRoot, skipped);
    const entries = parsed.filter((e): e is ParsedAdrEntry => e !== null);

    // Detect duplicate ADR IDs — two files sharing the same frontmatter id
    // is an authoring error that causes silent data loss downstream (Map.set
    // overwrites, Array.find picks the first, etc.).
    const idToFiles = new Map<string, string[]>();
    for (const entry of entries) {
      const id = entry.adr.frontmatter.id;
      const existing = idToFiles.get(id);
      if (existing) {
        existing.push(entry.file);
      } else {
        idToFiles.set(id, [entry.file]);
      }
    }
    const duplicates = [...idToFiles.entries()].filter(
      ([, files]) => files.length > 1
    );
    if (duplicates.length > 0) {
      const details = duplicates
        .map(
          ([id, files]) =>
            `Duplicate ADR ID: ${id}\n${files.map((f) => `  - ${f}`).join("\n")}`
        )
        .join("\n\n");
      throw new UserError(
        `${details}\n\nEach ADR must have a unique id in its YAML frontmatter.`
      );
    }

    return entries;
  })();

  parsedAdrsCache.set(projectRoot, promise);
  return promise;
}

/**
 * Discover ADRs with rules: true and dynamically import their companion .rules.ts files.
 */
export async function loadRuleAdrs(
  projectRoot: string,
  filterAdrId?: string
): Promise<LoadResult[]> {
  const pp = resolvedProjectPaths(projectRoot);

  // Ensure rules.d.ts exists so .rules.ts files get type checking
  // without requiring node_modules (supports non-JS projects).
  // When ADRs live in a custom directory, also write the shim there.
  await ensureRulesShim(projectRoot, pp.adrsDir);

  const adrsDir = pp.adrsDir;

  // Phase 1: Read and parse all ADR files in parallel (cached per process)
  const parsedAdrs = await parseAllAdrs(projectRoot);

  const ruleAdrs = parsedAdrs.filter((entry) => {
    if (!entry.adr.frontmatter.rules) return false;
    if (filterAdrId !== undefined && entry.adr.frontmatter.id !== filterAdrId)
      return false;
    return true;
  });

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
          const match = /^rules:\s*true/u.exec(adrLines[i]);
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

      // Use file:// URL to handle Windows backslash paths in import().
      let mod: Record<string, unknown>;
      try {
        const importedModule: unknown = await import(
          pathToFileURL(rulesFile).href
        );
        mod = isRecord(importedModule) ? importedModule : {};
      } catch (err) {
        // Bun throws AggregateError with "Parse error" for files with syntax
        // errors that pass the transpiler-based scanner but fail the full
        // import parser.  Surface the first inner error for a useful message.
        const msg =
          err instanceof AggregateError && err.errors.length > 0
            ? String(err.errors[0])
            : err instanceof Error
              ? err.message
              : String(err);
        return {
          type: "blocked",
          value: {
            adr,
            error: `ADR ${adr.frontmatter.id}: failed to import companion rule file — ${msg}`,
            violations: [
              {
                message: `Failed to load rule file: ${msg}`,
                file: rulesFile,
                line: 1,
                column: 0,
                endLine: 1,
                endColumn: 0,
              },
            ],
          },
        };
      }
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
