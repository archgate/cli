/** Git file-listing utilities for ADR scope resolution and change detection. */

import { logDebug } from "../helpers/log";

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
    throw new Error(`git ${args[0]} exited with code ${exitCode}`);
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
    try {
      const result = await runGit(
        ["ls-files", "--cached", "--others", "--exclude-standard"],
        projectRoot
      );
      const files = new Set(result.trim().split("\n").filter(Boolean));
      logDebug("Git tracked files:", files.size);
      return files;
    } catch {
      logDebug("Git tracked files lookup failed (not a git repo?)");
      return null;
    }
  })();

  trackedFilesCache.set(projectRoot, promise);
  return promise;
}

/** Resolve scoped files for an ADR based on its files globs. Respects .gitignore. */
export async function resolveScopedFiles(
  projectRoot: string,
  adrFileGlobs?: string[]
): Promise<string[]> {
  const patterns = adrFileGlobs ?? ["**/*"];
  const trackedFiles = await getGitTrackedFiles(projectRoot);

  const results = await Promise.all(
    patterns.map(async (pattern) => {
      const glob = new Bun.Glob(pattern);
      const files: string[] = [];
      // dot: true so ADR `files:` globs can target dot-prefixed source dirs
      // like `.github/`, `.husky/`, `.vscode/`. The git-tracked-files filter
      // below already excludes ignored files. See archgate/cli#222.
      for await (const file of glob.scan({ cwd: projectRoot, dot: true })) {
        const normalized = file.replaceAll("\\", "/");
        if (trackedFiles && !trackedFiles.has(normalized)) continue;
        files.push(normalized);
      }
      return files;
    })
  );

  const all = [...new Set(results.flat())].sort();
  logDebug(
    "Scoped files resolved:",
    all.length,
    "from patterns:",
    patterns.join(", ")
  );
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
    const staged = await runGit(
      ["diff", "--cached", "--name-only"],
      projectRoot
    );
    const unstaged = await runGit(["diff", "--name-only"], projectRoot);
    const all = new Set([
      ...staged.trim().split("\n").filter(Boolean),
      ...unstaged.trim().split("\n").filter(Boolean),
    ]);
    logDebug("Changed files (staged + unstaged):", all.size);
    return [...all].sort();
  } catch {
    logDebug("Failed to get changed files (not a git repo?)");
    return [];
  }
}
