// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/** Git file-listing utilities for ADR scope resolution and change detection. */

import { logDebug, logWarn } from "../helpers/log";
import { ensureBaseBranch } from "../helpers/project-config";
import { UserError } from "../helpers/user-error";
import { expandBracePattern, matchTrackedFiles } from "./glob-utils";

/** Warn when an ADR's resolved file scope exceeds this many files. */
export const SCOPE_FILE_WARN_THRESHOLD = 1000;
/** Warn when the glob scan phase takes longer than this (milliseconds). */
export const SCOPE_SCAN_WARN_MS = 2000;

/**
 * Run a git command using Bun.spawn (cross-platform, no shell).
 * Bun.$ hangs on Windows due to pipe handling issues — this is the safe alternative.
 */
async function runGit(args: string[], cwd: string): Promise<string> {
  logDebug("Running: git", args.join(" "));
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new UserError(`git ${args[0]} exited with code ${exitCode}`);
  }
  return text;
}

/**
 * Cache of tracked-files lookups per project root. `archgate check` calls
 * `resolveScopedFiles` once per ADR — without this cache that's N spawns of
 * `git ls-files` (one per ADR) instead of 1, which adds ~25ms × N on Windows.
 * The in-memory lifetime matches the process; file changes during a single
 * CLI invocation are not expected.
 */
const trackedFilesCache = new Map<string, Promise<Set<string> | null>>();

/** Get all git-tracked (non-ignored) files in the project. */
export function getGitTrackedFiles(
  projectRoot: string
): Promise<Set<string> | null> {
  const cached = trackedFilesCache.get(projectRoot);
  if (cached) return cached;

  const promise = (async () => {
    // `--cached` lists files deleted from the worktree but not yet staged;
    // a filesystem walk would never return those. Subtract `--deleted` so
    // in-memory pattern matching (matchTrackedFiles) sees exactly the
    // files that exist on disk. `--others` entries exist by definition.
    //
    // allSettled, not all: in a non-git directory the first spawn rejects,
    // and Promise.all would return while the sibling git process is still
    // running with projectRoot as its cwd — on Windows that live cwd handle
    // locks the directory (EBUSY on removal). Both must fully exit first.
    const [listed, deleted] = await Promise.allSettled([
      runGit(
        ["ls-files", "--cached", "--others", "--exclude-standard"],
        projectRoot
      ),
      runGit(["ls-files", "--deleted"], projectRoot),
    ]);
    if (listed.status === "rejected" || deleted.status === "rejected") {
      logDebug("Git tracked files lookup failed (not a git repo?)");
      return null;
    }
    const files = new Set(listed.value.trim().split("\n").filter(Boolean));
    for (const f of deleted.value.trim().split("\n").filter(Boolean)) {
      files.delete(f);
    }
    logDebug("Git tracked files:", files.size);
    return files;
  })();

  trackedFilesCache.set(projectRoot, promise);
  return promise;
}

/** Resolve scoped files for an ADR based on its files globs. Respects .gitignore by default. */
export async function resolveScopedFiles(
  projectRoot: string,
  adrFileGlobs?: string[],
  options?: {
    respectGitignore?: boolean;
    adrId?: string;
    /** Override the file-count warning threshold (defaults to SCOPE_FILE_WARN_THRESHOLD). */
    fileWarnThreshold?: number;
  }
): Promise<string[]> {
  const patterns = adrFileGlobs?.length ? adrFileGlobs : ["**/*"];
  const hasExplicitFiles = Boolean(adrFileGlobs?.length);
  const respectGitignore = options?.respectGitignore !== false;
  const label = options?.adrId ? `ADR ${options.adrId}` : "resolveScopedFiles";
  const fileWarnThreshold =
    options?.fileWarnThreshold ?? SCOPE_FILE_WARN_THRESHOLD;

  if (!respectGitignore && !hasExplicitFiles) {
    logWarn(
      `${label}: respectGitignore is false without a files scope — scanning all files including node_modules/, .git/, etc. This may be very slow. Add a files pattern to narrow the scope.`
    );
  }

  const trackedFiles = respectGitignore
    ? await getGitTrackedFiles(projectRoot)
    : null;

  const scanStart = performance.now();
  let dedupSet: Set<string>;
  if (trackedFiles) {
    // Fast path: match patterns against the tracked-file list in memory —
    // no filesystem traversal at all. match() handles brace groups with
    // path separators natively, so no expansion is needed here.
    dedupSet = matchTrackedFiles(patterns, trackedFiles);
  } else {
    // Fallback (not a git repo, or respectGitignore: false): walk the
    // filesystem. Expand brace patterns with path separators that Bun.Glob
    // scanning drops — see https://github.com/oven-sh/bun/issues/32596.
    const expanded = patterns.flatMap((p) => expandBracePattern(p));
    const scanSet = new Set<string>();
    await Promise.all(
      expanded.map(async (pattern) => {
        const glob = new Bun.Glob(pattern);
        // dot: true so ADR `files:` globs can target dot-prefixed source dirs
        // like `.github/`, `.husky/`, `.vscode/`. See archgate/cli#222.
        for await (const file of glob.scan({ cwd: projectRoot, dot: true })) {
          scanSet.add(file.replaceAll("\\", "/"));
        }
      })
    );
    dedupSet = scanSet;
  }
  const scanMs = performance.now() - scanStart;

  const all = Array.from(dedupSet).sort();

  if (all.length > fileWarnThreshold || scanMs > SCOPE_SCAN_WARN_MS) {
    logWarn(
      `${label}: Resolved ${all.length} files from patterns: ${patterns.join(", ")} (scan took ${Math.round(scanMs)}ms). Consider narrowing the \`files\` patterns in the ADR frontmatter to improve performance.`
    );
  }

  logDebug(
    "Scoped files resolved:",
    all.length,
    "from patterns:",
    patterns.join(", ")
  );

  // Warn when explicit file patterns yield zero results due to gitignore
  if (respectGitignore && hasExplicitFiles && all.length === 0) {
    const unfiltered = await resolveScopedFiles(projectRoot, adrFileGlobs, {
      respectGitignore: false,
    });
    if (unfiltered.length > 0) {
      logWarn(
        `${label}: files patterns matched ${unfiltered.length} file(s) but all are excluded by .gitignore. Set respectGitignore: false in the ADR frontmatter to include them.`
      );
    }
  }

  return all;
}

/** Get changed files from git staging area. */
export async function getStagedFiles(projectRoot: string): Promise<string[]> {
  try {
    const result = await runGit(
      ["diff", "--cached", "--name-only"],
      projectRoot
    );
    const files = result.trim().split("\n").filter(Boolean);
    logDebug("Staged files:", files.length);
    return files;
  } catch {
    logDebug("Failed to get staged files (not a git repo?)");
    return [];
  }
}

/** Get all changed files (staged + unstaged). */
export async function getChangedFiles(projectRoot: string): Promise<string[]> {
  try {
    const [staged, unstaged] = await Promise.all([
      runGit(["diff", "--cached", "--name-only"], projectRoot),
      runGit(["diff", "--name-only"], projectRoot),
    ]);
    const all = new Set(staged.trim().split("\n").filter(Boolean));
    for (const f of unstaged.trim().split("\n").filter(Boolean)) all.add(f);
    logDebug("Changed files (staged + unstaged):", all.size);
    return Array.from(all).sort();
  } catch {
    logDebug("Failed to get changed files (not a git repo?)");
    return [];
  }
}

/**
 * Detect the base ref to compare against for branch-level change detection.
 *
 * Resolution order:
 * 1. Remote HEAD symref (e.g. `origin/main`) — fast, local, no network
 * 2. `origin/main` or `origin/master` tracking refs
 * 3. Local `main` or `master` branches (repos without remotes)
 * 4. `null` — detection failed, caller falls back to empty changedFiles
 */
export async function detectBaseRef(
  projectRoot: string
): Promise<string | null> {
  // 1. Try remote HEAD symref (most reliable when origin exists)
  try {
    const symRef = await runGit(
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      projectRoot
    );
    const trimmed = symRef.trim();
    if (trimmed) {
      logDebug("Detected base ref from remote HEAD:", trimmed);
      return trimmed;
    }
  } catch {
    logDebug("No remote HEAD symref found");
  }

  // 2. Check common remote tracking branches (sequential — stop at first match)
  for (const ref of ["origin/main", "origin/master"]) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- sequential probe, stop at first hit
      await runGit(["rev-parse", "--verify", ref], projectRoot);
      logDebug("Detected base ref from tracking branch:", ref);
      return ref;
    } catch {
      // ref doesn't exist
    }
  }

  // 3. Check local branches (repos without remotes, sequential — stop at first match)
  for (const ref of ["main", "master"]) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- sequential probe, stop at first hit
      await runGit(["rev-parse", "--verify", ref], projectRoot);
      logDebug("Detected base ref from local branch:", ref);
      return ref;
    } catch {
      // ref doesn't exist
    }
  }

  logDebug("Could not detect base ref — changedFiles will be empty");
  return null;
}

/**
 * Resolve the base ref for branch-level change detection.
 *
 * Priority: explicit flag → project config → git auto-detect → undefined.
 * The `staged` flag short-circuits to `undefined` (caller uses staged files
 * instead of a branch diff).
 */
export async function resolveBaseRef(
  projectRoot: string,
  options: {
    staged?: boolean;
    base?: string | true;
    configBase?: string | null;
  }
): Promise<string | undefined> {
  if (options.staged) return undefined;

  if (typeof options.base === "string") {
    logDebug("Using explicit base ref:", options.base);
    return options.base;
  }

  if (options.configBase) {
    logDebug("Using configured base branch:", options.configBase);
    return options.configBase;
  }

  // Lazy-save: detect + persist to config.json so future runs skip detection.
  return (await ensureBaseBranch(projectRoot, detectBaseRef)) ?? undefined;
}

/**
 * Get files changed between a base ref and the working tree.
 *
 * Unions three sources so uncommitted work is never silently omitted
 * (see archgate/cli#403):
 * 1. `git diff base...HEAD` — committed branch changes (three-dot diff
 *    finds the merge-base automatically)
 * 2. staged + unstaged edits to tracked files
 * 3. untracked (non-gitignored) files
 *
 * Returns an empty array when the ref cannot be diffed (bad ref or not
 * a git repo), matching the previous behavior.
 */
export async function getFilesChangedSinceRef(
  projectRoot: string,
  ref: string
): Promise<string[]> {
  try {
    const [committed, workingTree, untracked] = await Promise.all([
      runGit(["diff", "--name-only", `${ref}...HEAD`], projectRoot),
      getChangedFiles(projectRoot),
      runGit(["ls-files", "--others", "--exclude-standard"], projectRoot),
    ]);
    const dedup = new Set(committed.trim().split("\n").filter(Boolean));
    for (const f of workingTree) dedup.add(f);
    for (const f of untracked.trim().split("\n").filter(Boolean)) dedup.add(f);
    const files = Array.from(dedup).sort();
    logDebug(`Files changed since ${ref} (incl. working tree):`, files.length);
    return files;
  } catch {
    logDebug(`Failed to get files changed since ${ref}`);
    return [];
  }
}

/**
 * Run git and return its stdout, or null when it exits non-zero — instead of
 * throwing like `runGit`. For the base-revision reads below, a non-zero exit
 * is an expected, meaningful signal (unknown ref, or a path that did not exist
 * at that revision), not an error to propagate.
 */
async function runGitOrNull(
  args: string[],
  cwd: string
): Promise<string | null> {
  logDebug("Running (nullable): git", args.join(" "));
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  // Drain both pipes concurrently with the exit wait so a large blob cannot
  // deadlock the stdout buffer (mirrors runAstSubprocess).
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const [exitCode] = await Promise.all([proc.exited, stderrPromise]);
  const stdout = await stdoutPromise;
  return exitCode === 0 ? stdout : null;
}

/**
 * Resolve the merge base of `ref` and HEAD — the commit `changedFiles`
 * compares against.
 *
 * `getFilesChangedSinceRef` diffs `ref...HEAD` (three-dot), which git resolves
 * against `merge-base(ref, HEAD)`. Base-revision reads MUST use that same
 * commit, or a rule would compare the working tree against a different point
 * than the change set it was handed. Returns null when no merge base exists
 * (unrelated histories) or `ref` is unknown.
 */
export async function getMergeBase(
  projectRoot: string,
  ref: string
): Promise<string | null> {
  const out = await runGitOrNull(["merge-base", ref, "HEAD"], projectRoot);
  const sha = out?.trim();
  return sha ? sha : null;
}

/**
 * Read a file's contents at a specific revision via `git show <rev>:<path>`.
 *
 * Returns null when the path did not exist at that revision (an added file) or
 * the revision is unresolvable — callers distinguish "absent at base" from a
 * present-but-empty file (which returns "").
 *
 * `path` MUST be repo-relative with forward slashes, exactly as it appears in
 * `changedFiles`/`scopedFiles`. Passed as an array argument (no shell), so a
 * path with spaces or shell metacharacters is safe.
 */
export function getFileAtRev(
  projectRoot: string,
  rev: string,
  path: string
): Promise<string | null> {
  return runGitOrNull(["show", `${rev}:${path}`], projectRoot);
}
