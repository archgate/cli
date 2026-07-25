// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { relative, resolve } from "node:path";

import type {
  AstLanguage,
  AstNode,
  AstOptions,
  EsTreeProgram,
  GrepMatch,
  PythonAstModule,
  RubyAstProgram,
  RuleContext,
  RuleReport,
  ViolationDetail,
} from "../formats/rules";
import { logDebug, logWarn } from "../helpers/log";
import {
  AST_LANGUAGE_EXTENSIONS,
  PYTHON_AST_PROGRAM,
  PYTHON_AST_WITH_COMMENTS_PROGRAM,
  RUBY_AST_PROGRAM,
  RUBY_AST_WITH_COMMENTS_PROGRAM,
  RUBY_BASENAMES,
  astCacheKey,
  finalizeAstResult,
  findAstNodes,
  implausibleLanguageError,
  interpreterCandidates,
  interpreterNotFoundError,
  materializeAstInput,
  parseAstJson,
  parseErrorMessage,
  probeInterpreter,
  readBaseSourceOrThrow,
  runAstSubprocess,
} from "./ast-support";
import {
  resolveScopedFiles,
  getStagedFiles,
  getFilesChangedSinceRef,
  getGitTrackedFiles,
  getMergeBase,
  getFileAtRev,
} from "./git-files";
import { listMatchingFiles, matchLines } from "./glob-utils";
import { parseTsOrJsSource } from "./js-parser";
import { type LoadResult, blockedToRuleResult } from "./loader";
import { isWithinRoot, resolveUserPath, safePath } from "./safe-path";
import { applySuppressions, type SuppressionWarning } from "./suppressions";

const RULE_TIMEOUT_MS = 30_000;

/**
 * Per-invocation caches shared across every rule context in a check run —
 * without them, 40+ rules repeat identical glob/read/parse work. Values are
 * promises so concurrent rules share in-flight work. Glob results are copied
 * on return; file text is immutable; AST trees are shared and read-only.
 * `readJSON` is NOT cached — sharing its mutable object would leak mutations.
 */
interface RunCaches {
  /** Glob results keyed by `tracked:`/`all:` + pattern. */
  globResults: Map<string, Promise<string[]>>;
  /** File contents keyed by absolute path. */
  fileText: Map<string, Promise<string>>;
  /** ctx.ast() parses keyed by the NUL-joined (absPath, language, rev, comments) tuple. */
  astResults: Map<string, Promise<AstNode>>;
}

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

function createRuleContext(
  projectRoot: string,
  scopedFiles: string[],
  changedFiles: string[],
  adrId: string,
  ruleId: string,
  violations: ViolationDetail[],
  trackedFiles: Set<string> | null,
  interpreterCache: Map<string, Promise<string | null>>,
  caches: RunCaches,
  baseRev: string | null
): RuleContext {
  const resolvedRoot = resolve(projectRoot);

  /**
   * Glob with per-run memoization. Callers must copy the resolved array.
   * Pattern sandboxing (no `..`, no absolute paths — including inside brace
   * alternatives) happens inside listMatchingFiles, on both of its paths.
   */
  function cachedGlob(pattern: string): Promise<string[]> {
    const key = (trackedFiles ? "tracked:" : "all:") + pattern;
    let hit = caches.globResults.get(key);
    if (!hit) {
      hit = listMatchingFiles(projectRoot, pattern, trackedFiles);
      caches.globResults.set(key, hit);
    }
    return hit;
  }

  /** Read file text with per-run memoization (strings are immutable). */
  function cachedFileText(absPath: string): Promise<string> {
    let hit = caches.fileText.get(absPath);
    if (!hit) {
      hit = Bun.file(absPath).text();
      caches.fileText.set(absPath, hit);
    }
    return hit;
  }

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

  // ARCH-022: ctx.ast() implementation. Overload declarations match
  // RuleContext["ast"] so each language narrows to the correct return type.
  // The four guardrails below MUST run in this order before any subprocess.
  // `{ rev: "base" }` swaps only the source acquisition (content at the
  // comparison base commit); the guardrails are identical.
  async function astImpl(
    path: string,
    language: "typescript" | "javascript",
    opts?: AstOptions
  ): Promise<EsTreeProgram>;
  async function astImpl(
    path: string,
    language: "python",
    opts?: AstOptions
  ): Promise<PythonAstModule>;
  async function astImpl(
    path: string,
    language: "ruby",
    opts?: AstOptions
  ): Promise<RubyAstProgram>;
  // oxlint-disable-next-line require-await -- async keeps guardrail failures as rejections, never sync throws
  async function astImpl(
    path: string,
    language: AstLanguage,
    opts?: AstOptions
  ) {
    // Guardrail 1: path safety — same sandbox as readFile/glob. Applied even
    // for { rev: "base" }, where the bytes come from git rather than disk: the
    // path still must be a sane in-project path, and this yields the
    // repo-relative form `git show` needs.
    const absPath = safePath(resolvedRoot, path);
    const relPath = relative(resolvedRoot, absPath).replaceAll("\\", "/");
    const useBase = opts?.rev === "base";
    const wantComments = opts?.comments === true;

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
      throw implausibleLanguageError(language, path);
    }

    /**
     * The uncached parse: TS/JS in-process, Python/Ruby via guardrails 3–4.
     * Errors below are CACHED (see the astResults lookup), so they
     * interpolate the normalized `relPath` — never the raw `path` — else a
     * cached rejection would carry the first caller's path spelling into
     * every later caller's error (aliased spellings share a cache entry).
     */
    async function parseUncached(): Promise<AstNode> {
      // In-process branch: TypeScript/JavaScript via the shared meriyah
      // parser (js-parser.ts). No subprocess is spawned for these languages.
      if (language === "typescript" || language === "javascript") {
        const source = useBase
          ? await readBaseSourceOrThrow(projectRoot, baseRev, relPath, relPath)
          : await cachedFileText(absPath);
        try {
          // Meriyah's Program is ESTree-shaped but lacks the index signature.
          // `path` is safe here: it only picks the parse mode by extension.
          const tree = parseTsOrJsSource(language, path, source, wantComments);
          return tree as unknown as EsTreeProgram;
        } catch (err) {
          throw new Error(
            `Failed to parse "${relPath}" as ${language}: ${parseErrorMessage(err)}`
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
        throw interpreterNotFoundError(language, candidates, relPath);
      }

      // For { rev: "base" }, the interpreter serializers read a file path from
      // argv, but the base content is not on disk — materialize it to a throwaway
      // temp file and hand that path to the same, unchanged program (and the same
      // `-I` isolation). Cleaned up in `finally` regardless of outcome.
      const { sourcePath, cleanup } = await materializeAstInput({
        useBase,
        absPath,
        ext: language === "python" ? ".py" : ".rb",
        projectRoot,
        baseRev,
        relPath,
        displayPath: relPath,
      });

      try {
        // Guardrail 4: guarded invocation — array args only, path via argv.
        // Python runs isolated (-I): without it `python -c` puts the target
        // project root on sys.path, letting a hostile project shadow stdlib
        // modules (ast.py, json.py) for arbitrary code execution. Ruby's load
        // path excludes the cwd (1.9.2+), so it is safe as-is.
        const pyProgram = wantComments
          ? PYTHON_AST_WITH_COMMENTS_PROGRAM
          : PYTHON_AST_PROGRAM;
        const rubyProgram = wantComments
          ? RUBY_AST_WITH_COMMENTS_PROGRAM
          : RUBY_AST_PROGRAM;
        const cmd =
          language === "python"
            ? [interpreter, "-I", "-c", pyProgram, sourcePath]
            : [
                interpreter,
                "-rripper",
                "-rjson",
                "-e",
                rubyProgram,
                sourcePath,
              ];
        const { exitCode, stdout, stderr } = await runAstSubprocess(cmd);
        if (exitCode !== 0) {
          const detail = stderr.trim() || `exit code ${exitCode}`;
          throw new Error(
            `Failed to parse "${relPath}" as ${language}: ${detail}`
          );
        }
        return finalizeAstResult(
          parseAstJson(stdout, relPath, language),
          language,
          wantComments
        ) as AstNode;
      } finally {
        cleanup?.();
      }
    }

    // Per-run parse cache mirroring cachedGlob/cachedFileText, keyed on the
    // full output-determining tuple, NUL-joined (NUL cannot appear in a path).
    // The PROMISE is cached so concurrent identical calls share one in-flight
    // parse; rejections stay cached — ctx.ast() is fail-closed (ARCH-022) —
    // and the cheap guardrails above still run per call before this lookup.
    const cacheKey = astCacheKey(absPath, language, useBase, wantComments);
    let hit = caches.astResults.get(cacheKey);
    if (!hit) {
      hit = parseUncached();
      caches.astResults.set(cacheKey, hit);
    }
    return hit;
  }

  return {
    projectRoot,
    scopedFiles,
    changedFiles,
    report,

    async glob(pattern: string): Promise<string[]> {
      // Copy the cached array — rules may mutate their result (sort,
      // splice, ...) and must not corrupt what other rules receive.
      return [...(await cachedGlob(pattern))];
    },

    async grep(file: string, pattern: RegExp): Promise<GrepMatch[]> {
      const absPath = safePath(resolvedRoot, file);
      const content = await cachedFileText(absPath);
      const relPath = relative(projectRoot, absPath).replaceAll("\\", "/");
      return matchLines(content, pattern, relPath);
    },

    async grepFiles(pattern: RegExp, fileGlob: string): Promise<GrepMatch[]> {
      // Collect paths first, then read in parallel batches for I/O throughput.
      const files = await cachedGlob(fileGlob);

      const BATCH_SIZE = 32;
      const allMatches: GrepMatch[] = [];

      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        // oxlint-disable-next-line no-await-in-loop -- batched parallelism with sequential batch boundaries
        const batchResults = await Promise.all(
          batch.map(async (normalized) => {
            const absPath = safePath(resolvedRoot, normalized);
            try {
              const content = await cachedFileText(absPath);
              return matchLines(content, pattern, normalized);
            } catch {
              // Skip unreadable files
              return [];
            }
          })
        );
        for (const matches of batchResults) {
          for (const m of matches) allMatches.push(m);
        }
      }

      return allMatches;
    },

    readFile(path: string): Promise<string> {
      const absPath = safePath(resolvedRoot, path);
      return cachedFileText(absPath);
    },

    /**
     * Read a file's source at the comparison base revision. Returns null when
     * no base is resolved (no `--base`, or unrelated histories) or the path
     * did not exist at the base — the two "nothing to compare against" cases,
     * checkable with one null test. Unlike `ctx.ast({ rev: "base" })`, this
     * primitive reports absence as null rather than throwing.
     */
    fileAtBase(path: string): Promise<string | null> {
      const absPath = safePath(resolvedRoot, path);
      if (!baseRev) return Promise.resolve(null);
      const relPath = relative(resolvedRoot, absPath).replaceAll("\\", "/");
      return getFileAtRev(projectRoot, baseRev, relPath);
    },

    readJSON(path: string): Promise<any> {
      return Bun.file(safePath(resolvedRoot, path)).json();
    },

    // ARCH-022: the only sanctioned path from rule code to language tooling.
    ast: astImpl,
    // Generic by-type-name AST node collector — a pure, synchronous
    // traversal built in like glob/grep so rule files need not hand-roll it.
    findAstNodes,
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

  // Tracked-file listing is independent of the base — start it first so it runs
  // concurrently with the merge-base resolution below.
  const allTrackedFilesPromise = getGitTrackedFiles(projectRoot);

  // Resolve the base commit ONCE per run — the merge base of `--base` and HEAD
  // — and reuse the single SHA for BOTH `changedFiles` and base-revision reads
  // (`ctx.fileAtBase()` / `ctx.ast({ rev: "base" })`); separate resolution
  // could hand a rule a change set and a base AST from different commits if
  // the branch moves mid-run (ARCH-022). Null for staged/default runs.
  const baseRev: string | null =
    !options.staged && options.base
      ? await getMergeBase(projectRoot, options.base)
      : null;

  const changedFilesPromise = options.staged
    ? getStagedFiles(projectRoot)
    : baseRev
      ? getFilesChangedSinceRef(projectRoot, baseRev)
      : Promise.resolve([]);

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

  // Resolve user-specified files to relative paths for intersection.
  // Files are a pure filter — they are intersected with ADR-scoped files and
  // never read directly, so a path outside the project root can never match
  // anything. Skip such paths with a warning instead of failing the whole
  // run: agents and hooks routinely pipe in stray paths (e.g. temp files).
  let filterFiles: Set<string> | undefined;
  if (options.files && options.files.length > 0) {
    const resolvedRoot = resolve(projectRoot);
    filterFiles = new Set();
    for (const f of options.files) {
      const absPath = resolveUserPath(resolvedRoot, f);
      if (!isWithinRoot(resolvedRoot, absPath)) {
        logWarn(`Skipping "${f}" — outside project root, not governed by ADRs`);
        continue;
      }
      filterFiles.add(relative(projectRoot, absPath).replaceAll("\\", "/"));
    }
  }

  // Await the git operations (started above, run concurrently). `baseRev` is
  // already resolved and reused by `changedFilesPromise`.
  const [changedFiles, allTrackedFiles] = await Promise.all([
    changedFilesPromise,
    allTrackedFilesPromise,
  ]);

  // ARCH-022: the ctx.ast() interpreter probe is cached once per check
  // invocation — shared across every ADR and rule in this run.
  const interpreterCache = new Map<string, Promise<string | null>>();

  // Per-run glob/file-text/AST caches shared across all rule contexts — rules
  // overwhelmingly repeat the same globs, reads, and parses (see RunCaches).
  const caches: RunCaches = {
    globResults: new Map(),
    fileText: new Map(),
    astResults: new Map(),
  };

  const adrResults = await Promise.allSettled(
    loadedAdrs.map(async ({ adr, ruleSet }) => {
      const respectGitignore = adr.frontmatter.respectGitignore !== false;
      const trackedFiles = respectGitignore ? allTrackedFiles : null;

      let scopedFiles = await resolveScopedFiles(
        projectRoot,
        adr.frontmatter.files,
        { respectGitignore, adrId: adr.frontmatter.id }
      );

      if (filterFiles) {
        scopedFiles = scopedFiles.filter((f) => filterFiles.has(f));
      }

      if (filterFiles && scopedFiles.length === 0) {
        return [];
      }

      const adrRuleResults: RuleResult[] = [];

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
          interpreterCache,
          caches,
          baseRev
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

  for (const result of adrResults) {
    if (result.status === "fulfilled") {
      for (const r of result.value) results.push(r);
    }
  }

  // Apply inline suppressions (archgate-ignore / archgate-ignore-file comments)
  const suppression = await applySuppressions(projectRoot, results);

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
