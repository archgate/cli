// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { lstatSync } from "node:fs";
import { relative, resolve, isAbsolute } from "node:path";

import type {
  AstLanguage,
  AstNode,
  EsTreeProgram,
  GrepMatch,
  RuleContext,
  RuleReport,
  ViolationDetail,
} from "../formats/rules";
import { logDebug } from "../helpers/log";
import { UserError } from "../helpers/user-error";
import {
  AST_LANGUAGE_EXTENSIONS,
  PYTHON_AST_PROGRAM,
  RUBY_AST_PROGRAM,
  RUBY_BASENAMES,
  interpreterCandidates,
  parseAstJson,
  parseErrorMessage,
  probeInterpreter,
  runAstSubprocess,
} from "./ast-support";
import {
  resolveScopedFiles,
  getStagedFiles,
  getFilesChangedSinceRef,
  getGitTrackedFiles,
} from "./git-files";
import { parseJsModule } from "./js-parser";
import { type LoadResult, blockedToRuleResult } from "./loader";
import { applySuppressions, type SuppressionWarning } from "./suppressions";

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
    throw new UserError(
      `Path "${userPath}" escapes project root — access denied`
    );
  }
  // Reject symlinks to prevent following links to files outside the project
  try {
    if (lstatSync(absPath).isSymbolicLink()) {
      throw new UserError(
        `Path "${userPath}" is a symbolic link — access denied`
      );
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
    throw new UserError(
      `Glob pattern "${pattern}" contains ".." — access denied`
    );
  }
  if (isAbsolute(pattern)) {
    throw new UserError(
      `Glob pattern "${pattern}" is absolute — access denied`
    );
  }
}
/**
 * Expand brace patterns that contain path separators into separate patterns.
 *
 * Bun.Glob scanning silently returns empty results for brace groups whose
 * alternatives contain `/` (e.g. `svc/{src/env.ts,env.ts}`).  match() handles
 * them correctly — only the scanner is broken.  Filed upstream as
 * https://github.com/oven-sh/bun/issues/32596.
 *
 * This function detects `{alt1,alt2,...}` groups where at least one alternative
 * contains `/` and expands them into separate patterns so each one can be
 * scanned individually.  Braces whose alternatives are all simple names (no `/`)
 * are left for Bun.Glob to handle natively.
 */
export function expandBracePattern(pattern: string): string[] {
  const match = pattern.match(/^(.*?)\{([^{}]+)\}(.*)$/u);
  if (!match) return [pattern];

  const [, prefix, alternatives, suffix] = match;
  if (!alternatives.includes("/")) {
    // This brace group is safe for Bun.Glob, but check the suffix for others.
    const expandedSuffixes = expandBracePattern(suffix);
    if (expandedSuffixes.length === 1 && expandedSuffixes[0] === suffix) {
      return [pattern];
    }
    return expandedSuffixes.map((s) => `${prefix}{${alternatives}}${s}`);
  }

  const parts = alternatives.split(",");
  return parts.flatMap((part) =>
    expandBracePattern(`${prefix}${part}${suffix}`)
  );
}

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
  suppressedCount?: number;
  suppressionWarnings?: SuppressionWarning[];
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
  violations: ViolationDetail[],
  trackedFiles: Set<string> | null,
  interpreterCache: Map<string, Promise<string | null>>
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

  // ARCH-022: ctx.ast() implementation. Declared as a const cast to the
  // overloaded RuleContext["ast"] type so this single implementation
  // signature satisfies the language-narrowed public overloads (a single
  // broad signature is not directly assignable to the narrow overloads).
  // The four guardrails below MUST run in this order before any subprocess.
  const astImpl = (async (
    path: string,
    language: AstLanguage
  ): Promise<AstNode> => {
    // Guardrail 1: path safety — same sandbox as readFile/glob.
    const absPath = safePath(projectRoot, path);

    // Guardrail 2: language plausibility — refuse to hand a file to an
    // interpreter unless its name plausibly matches the requested language.
    const lowerPath = path.toLowerCase();
    const basename = lowerPath.split(/[/\\]/u).pop() ?? "";
    const plausible =
      AST_LANGUAGE_EXTENSIONS[language].some((ext) =>
        lowerPath.endsWith(ext)
      ) ||
      (language === "ruby" && RUBY_BASENAMES.has(basename));
    if (!plausible) {
      throw new UserError(
        `File "${path}" does not look like ${language} (expected ${AST_LANGUAGE_EXTENSIONS[
          language
        ].join(", ")}) — refusing to parse`
      );
    }

    // In-process branch: TypeScript/JavaScript via the shared meriyah
    // parser (js-parser.ts). No subprocess is spawned for these languages.
    if (language === "typescript" || language === "javascript") {
      const source = await Bun.file(absPath).text();
      try {
        if (language === "typescript") {
          const loader = lowerPath.endsWith(".tsx") ? "tsx" : "ts";
          const js = new Bun.Transpiler({ loader }).transformSync(source);
          return parseJsModule(js) as unknown as EsTreeProgram;
        }
        // .cjs cannot legally contain import/export in Node — parse it as
        // a sloppy-mode script so CommonJS-isms (top-level return, `with`)
        // do not fail under module/strict grammar.
        return parseJsModule(source, {
          jsx: lowerPath.endsWith(".jsx"),
          sourceType: lowerPath.endsWith(".cjs") ? "script" : "module",
        }) as unknown as EsTreeProgram;
      } catch (err) {
        throw new Error(
          `Failed to parse "${path}" as ${language}: ${parseErrorMessage(err)}`
        );
      }
    }

    // Guardrail 3: interpreter availability probe, cached per check run.
    const candidates = interpreterCandidates(language);
    let probe = interpreterCache.get(language);
    if (!probe) {
      probe = probeInterpreter(candidates);
      interpreterCache.set(language, probe);
    }
    const interpreter = await probe;
    if (!interpreter) {
      throw new Error(
        `${language === "python" ? "Python" : "Ruby"} interpreter not found on PATH (tried: ${candidates.join(
          ", "
        )}) — ctx.ast("${path}", "${language}") requires it wherever \`archgate check\` runs`
      );
    }

    // Guardrail 4: guarded invocation — array args only, path via argv.
    // Python runs in isolated mode (-I): without it, `python -c` puts the
    // cwd (the target project root) on sys.path, so a hostile project
    // could shadow stdlib modules (ast.py, json.py) and execute arbitrary
    // code when the serializer imports them. Ruby is safe as-is — its
    // load path has not included the cwd since 1.9.2.
    const cmd =
      language === "python"
        ? [interpreter, "-I", "-c", PYTHON_AST_PROGRAM, absPath]
        : [interpreter, "-rripper", "-rjson", "-e", RUBY_AST_PROGRAM, absPath];
    const { exitCode, stdout, stderr } = await runAstSubprocess(cmd);
    if (exitCode !== 0) {
      const detail = stderr.trim() || `exit code ${exitCode}`;
      throw new Error(`Failed to parse "${path}" as ${language}: ${detail}`);
    }
    return parseAstJson(stdout, path, language) as unknown as AstNode;
  }) as unknown as RuleContext["ast"];

  return {
    projectRoot,
    scopedFiles,
    changedFiles,
    report,

    async glob(pattern: string): Promise<string[]> {
      safeGlob(pattern);
      // Expand brace patterns with path separators that Bun.Glob scanning drops.
      // See https://github.com/oven-sh/bun/issues/32596.
      const patterns = expandBracePattern(pattern);
      const seen = new Set<string>();
      for (const p of patterns) {
        safeGlob(p);
        const g = new Bun.Glob(p);
        // dot: true so rules can target dot-prefixed paths like `.github/`,
        // `.husky/`, `.vscode/` — first-class source dirs in code repos.
        // See https://github.com/archgate/cli/issues/222.
        // oxlint-disable-next-line no-await-in-loop -- sequential scan per expanded brace alternative
        for await (const file of g.scan({ cwd: projectRoot, dot: true })) {
          const normalized = file.replaceAll("\\", "/");
          if (trackedFiles && !trackedFiles.has(normalized)) continue;
          seen.add(normalized);
        }
      }
      return [...seen].sort();
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
      // Expand brace patterns with path separators that Bun.Glob scanning drops.
      // See https://github.com/oven-sh/bun/issues/32596.
      const globs = expandBracePattern(fileGlob);

      // Collect paths first, then read in parallel batches for I/O throughput.
      // dot: true to match dot-prefixed source dirs (`.github/`, etc.).
      // See https://github.com/archgate/cli/issues/222.
      const seen = new Set<string>();
      for (const p of globs) {
        safeGlob(p);
        const g = new Bun.Glob(p);
        // oxlint-disable-next-line no-await-in-loop -- sequential scan per expanded brace alternative
        for await (const file of g.scan({ cwd: projectRoot, dot: true })) {
          const normalized = file.replaceAll("\\", "/");
          if (trackedFiles && !trackedFiles.has(normalized)) continue;
          seen.add(normalized);
        }
      }
      const files = [...seen];

      const BATCH_SIZE = 32;
      const allMatches: GrepMatch[] = [];

      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        // oxlint-disable-next-line no-await-in-loop -- batched parallelism with sequential batch boundaries
        const batchResults = await Promise.all(
          batch.map(async (normalized) => {
            const absPath = safePath(projectRoot, normalized);
            try {
              const content = await Bun.file(absPath).text();
              const lines = content.split("\n");
              const matches: GrepMatch[] = [];

              for (let j = 0; j < lines.length; j++) {
                const match = lines[j].match(pattern);
                if (match) {
                  matches.push({
                    file: normalized,
                    line: j + 1,
                    column: (match.index ?? 0) + 1,
                    content: lines[j],
                  });
                }
              }

              return matches;
            } catch {
              // Skip unreadable files
              return [];
            }
          })
        );
        for (const matches of batchResults) {
          allMatches.push(...matches);
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

    // ARCH-022: the only sanctioned path from rule code to language tooling.
    ast: astImpl,
  };
}

/**
 * Run all rules from loaded ADRs. Parallel across ADRs, sequential within each ADR.
 */
export async function runChecks(
  projectRoot: string,
  loadResults: LoadResult[],
  options: { staged?: boolean; files?: string[]; base?: string } = {}
): Promise<CheckResult> {
  const startTime = performance.now();

  // Start git I/O concurrently — changedFiles and trackedFiles are independent
  const changedFilesPromise = options.staged
    ? getStagedFiles(projectRoot)
    : options.base
      ? getFilesChangedSinceRef(projectRoot, options.base)
      : Promise.resolve([]);
  const allTrackedFilesPromise = getGitTrackedFiles(projectRoot);

  // Do synchronous work while git subprocesses run
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

  // Await both git operations (started above, run concurrently)
  const [changedFiles, allTrackedFiles] = await Promise.all([
    changedFilesPromise,
    allTrackedFilesPromise,
  ]);

  // ARCH-022: the ctx.ast() interpreter probe is cached once per check
  // invocation — shared across every ADR and rule in this run.
  const interpreterCache = new Map<string, Promise<string | null>>();

  // Run ADRs in parallel
  const adrResults = await Promise.allSettled(
    loadedAdrs.map(async ({ adr, ruleSet }) => {
      const respectGitignore = adr.frontmatter.respectGitignore !== false;
      const trackedFiles = respectGitignore ? allTrackedFiles : null;

      let scopedFiles = await resolveScopedFiles(
        projectRoot,
        adr.frontmatter.files,
        { respectGitignore, adrId: adr.frontmatter.id }
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
          violations,
          trackedFiles,
          interpreterCache
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

  // Apply inline suppressions (archgate-ignore / archgate-ignore-file comments)
  const suppression = await applySuppressions(projectRoot, results);

  // Filter suppressed violations from each rule result
  if (suppression.suppressedCount > 0) {
    for (const r of results) {
      r.violations = r.violations.filter((v) =>
        suppression.activeViolations.has(v)
      );
    }
  }

  return {
    results,
    totalDurationMs: performance.now() - startTime,
    suppressedCount: suppression.suppressedCount,
    suppressionWarnings: suppression.warnings,
  };
}
