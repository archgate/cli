import { join, relative, isAbsolute } from "node:path";

import type {
  GrepMatch,
  RuleContext,
  RuleReport,
  ViolationDetail,
} from "../formats/rules";
import { logDebug } from "../helpers/log";
import { resolveScopedFiles, getStagedFiles } from "./git-files";
import type { LoadedAdr } from "./loader";

const RULE_TIMEOUT_MS = 30_000;

export interface RuleResult {
  ruleId: string;
  adrId: string;
  description: string;
  violations: ViolationDetail[];
  error?: string;
  durationMs: number;
}

export interface CheckResult {
  results: RuleResult[];
  totalDurationMs: number;
}

/**
 * Create a RuleContext for a specific rule execution.
 */
function createRuleContext(
  projectRoot: string,
  scopedFiles: string[],
  changedFiles: string[],
  adrId: string,
  ruleId: string,
  violations: ViolationDetail[]
): RuleContext {
  const report: RuleReport = {
    violation(detail) {
      violations.push({ ...detail, ruleId, adrId, severity: "error" });
    },
    warning(detail) {
      violations.push({ ...detail, ruleId, adrId, severity: "warning" });
    },
    info(detail) {
      violations.push({ ...detail, ruleId, adrId, severity: "info" });
    },
  };

  return {
    projectRoot,
    scopedFiles,
    changedFiles,
    report,

    async glob(pattern: string): Promise<string[]> {
      const g = new Bun.Glob(pattern);
      const results: string[] = [];
      for await (const file of g.scan({ cwd: projectRoot, dot: false })) {
        results.push(file.replaceAll("\\", "/"));
      }
      return results.sort();
    },

    async grep(file: string, pattern: RegExp): Promise<GrepMatch[]> {
      const absPath = isAbsolute(file) ? file : join(projectRoot, file);
      const content = await Bun.file(absPath).text();
      const lines = content.split("\n");
      const matches: GrepMatch[] = [];

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(pattern);
        if (match) {
          matches.push({
            file: relative(projectRoot, absPath).replaceAll("\\", "/"),
            line: i + 1,
            column: (match.index ?? 0) + 1,
            content: lines[i],
          });
        }
      }

      return matches;
    },

    async grepFiles(pattern: RegExp, fileGlob: string): Promise<GrepMatch[]> {
      const g = new Bun.Glob(fileGlob);
      const allMatches: GrepMatch[] = [];

      for await (const file of g.scan({ cwd: projectRoot, dot: false })) {
        const normalized = file.replaceAll("\\", "/");
        const absPath = join(projectRoot, file);
        try {
          const content = await Bun.file(absPath).text();
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(pattern);
            if (match) {
              allMatches.push({
                file: normalized,
                line: i + 1,
                column: (match.index ?? 0) + 1,
                content: lines[i],
              });
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      return allMatches;
    },

    readFile(path: string): Promise<string> {
      const absPath = isAbsolute(path) ? path : join(projectRoot, path);
      return Bun.file(absPath).text();
    },

    readJSON(path: string): Promise<unknown> {
      const absPath = isAbsolute(path) ? path : join(projectRoot, path);
      return Bun.file(absPath).json();
    },
  };
}

/**
 * Run all rules from loaded ADRs. Parallel across ADRs, sequential within each ADR.
 */
export async function runChecks(
  projectRoot: string,
  loadedAdrs: LoadedAdr[],
  options: { staged?: boolean } = {}
): Promise<CheckResult> {
  const startTime = performance.now();
  const changedFiles = options.staged ? await getStagedFiles(projectRoot) : [];
  const results: RuleResult[] = [];

  // Run ADRs in parallel
  const adrResults = await Promise.allSettled(
    loadedAdrs.map(async ({ adr, ruleSet }) => {
      const scopedFiles = await resolveScopedFiles(
        projectRoot,
        adr.frontmatter.files
      );

      const adrRuleResults: RuleResult[] = [];

      // Run rules within an ADR sequentially
      for (const [ruleId, ruleConfig] of Object.entries(ruleSet.rules)) {
        const violations: ViolationDetail[] = [];
        const ruleStart = performance.now();

        const ctx = createRuleContext(
          projectRoot,
          scopedFiles,
          changedFiles,
          adr.frontmatter.id,
          ruleId,
          violations
        );

        try {
          // oxlint-disable-next-line no-await-in-loop -- rules within an ADR run sequentially
          await Promise.race([
            ruleConfig.check(ctx),
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `Rule ${ruleId} timed out after ${RULE_TIMEOUT_MS}ms`
                    )
                  ),
                RULE_TIMEOUT_MS
              )
            ),
          ]);

          adrRuleResults.push({
            ruleId,
            adrId: adr.frontmatter.id,
            description: ruleConfig.description,
            violations,
            durationMs: performance.now() - ruleStart,
          });
        } catch (err) {
          adrRuleResults.push({
            ruleId,
            adrId: adr.frontmatter.id,
            description: ruleConfig.description,
            violations,
            error: err instanceof Error ? err.message : String(err),
            durationMs: performance.now() - ruleStart,
          });
        }

        logDebug(
          `Rule ${adr.frontmatter.id}/${ruleId}: ${violations.length} violations, ${(performance.now() - ruleStart).toFixed(0)}ms`
        );
      }

      return adrRuleResults;
    })
  );

  // Collect results
  for (const result of adrResults) {
    if (result.status === "fulfilled") {
      results.push(...result.value);
    }
  }

  return { results, totalDurationMs: performance.now() - startTime };
}
