import { lstatSync } from "node:fs";
import { relative, resolve, isAbsolute } from "node:path";

import type {
  GrepMatch,
  RuleContext,
  RuleReport,
  ViolationDetail,
} from "../formats/rules";
import { logDebug } from "../helpers/log";
import { resolveScopedFiles, getStagedFiles } from "./git-files";
import { type LoadResult, blockedToRuleResult } from "./loader";

/**
 * Resolve a user-supplied path and ensure it stays within projectRoot.
 * Throws if the resolved path escapes the project boundary or is a symlink.
 */
function safePath(projectRoot: string, userPath: string): string {
  const root = resolve(projectRoot);
  const absPath = isAbsolute(userPath)
    ? resolve(userPath)
    : resolve(root, userPath);
  // On Windows, paths on different drives produce a full absolute relative()
  // result rather than a ".." prefix — use startsWith on the normalized paths.
  if (
    !absPath.startsWith(root + "/") &&
    !absPath.startsWith(root + "\\") &&
    absPath !== root
  ) {
    throw new Error(`Path "${userPath}" escapes project root — access denied`);
  }
  // Reject symlinks to prevent following links to files outside the project
  try {
    if (lstatSync(absPath).isSymbolicLink()) {
      throw new Error(`Path "${userPath}" is a symbolic link — access denied`);
    }
  } catch (err) {
    // Re-throw our own errors; ignore ENOENT (file may not exist yet for glob results)
    if (err instanceof Error && err.message.includes("access denied")) {
      throw err;
    }
  }
  return absPath;
}

/**
 * Validate that a glob pattern cannot escape projectRoot via `..` segments.
 */
function safeGlob(pattern: string): void {
  if (pattern.includes("..")) {
    throw new Error(`Glob pattern "${pattern}" contains ".." — access denied`);
  }
  if (isAbsolute(pattern)) {
    throw new Error(`Glob pattern "${pattern}" is absolute — access denied`);
  }
}
const RULE_TIMEOUT_MS = 30_000;

interface RuleResult {
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
      safeGlob(pattern);
      const g = new Bun.Glob(pattern);
      const results: string[] = [];
      // dot: true so rules can target dot-prefixed paths like `.github/`,
      // `.husky/`, `.vscode/` — first-class source dirs in code repos.
      // See https://github.com/archgate/cli/issues/222.
      for await (const file of g.scan({ cwd: projectRoot, dot: true })) {
        results.push(file.replaceAll("\\", "/"));
      }
      return results.sort();
    },

    async grep(file: string, pattern: RegExp): Promise<GrepMatch[]> {
      const absPath = safePath(projectRoot, file);
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
      safeGlob(fileGlob);
      const g = new Bun.Glob(fileGlob);
      const allMatches: GrepMatch[] = [];

      // dot: true to match dot-prefixed source dirs (`.github/`, etc.).
      // See https://github.com/archgate/cli/issues/222.
      for await (const file of g.scan({ cwd: projectRoot, dot: true })) {
        const normalized = file.replaceAll("\\", "/");
        const absPath = safePath(projectRoot, file);
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
      const absPath = safePath(projectRoot, path);
      return Bun.file(absPath).text();
    },

    readJSON(path: string): Promise<any> {
      const absPath = safePath(projectRoot, path);
      return Bun.file(absPath).json();
    },
  };
}

/**
 * Run all rules from loaded ADRs. Parallel across ADRs, sequential within each ADR.
 */
export async function runChecks(
  projectRoot: string,
  loadResults: LoadResult[],
  options: { staged?: boolean; files?: string[] } = {}
): Promise<CheckResult> {
  const startTime = performance.now();
  const changedFiles = options.staged ? await getStagedFiles(projectRoot) : [];
  const results: RuleResult[] = loadResults
    .filter((lr) => lr.type === "blocked")
    .map((lr) => blockedToRuleResult(projectRoot, lr.value));
  const loadedAdrs = loadResults
    .filter(
      (lr): lr is Extract<LoadResult, { type: "loaded" }> =>
        lr.type === "loaded"
    )
    .map((lr) => lr.value);

  // Resolve user-specified files to relative paths for intersection
  let filterFiles: Set<string> | undefined;
  if (options.files && options.files.length > 0) {
    filterFiles = new Set(
      options.files.map((f) => {
        const absPath = safePath(projectRoot, f);
        return relative(projectRoot, absPath).replaceAll("\\", "/");
      })
    );
  }

  // Run ADRs in parallel
  const adrResults = await Promise.allSettled(
    loadedAdrs.map(async ({ adr, ruleSet }) => {
      let scopedFiles = await resolveScopedFiles(
        projectRoot,
        adr.frontmatter.files
      );

      // When files are specified, narrow scopedFiles to the intersection
      if (filterFiles) {
        scopedFiles = scopedFiles.filter((f) => filterFiles.has(f));
      }

      // Skip this ADR entirely if no specified files are in scope
      if (filterFiles && scopedFiles.length === 0) {
        return [];
      }

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
          // Cancel the timeout when the rule resolves first — otherwise the
          // timer keeps the event loop alive even after checks complete.
          let timer: ReturnType<typeof setTimeout> | undefined;
          // oxlint-disable-next-line no-await-in-loop -- rules within an ADR run sequentially
          await Promise.race([
            ruleConfig.check(ctx),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      `Rule ${ruleId} timed out after ${RULE_TIMEOUT_MS}ms`
                    )
                  ),
                RULE_TIMEOUT_MS
              );
            }),
          ]).finally(() => {
            if (timer) clearTimeout(timer);
          });

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
