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

/** Get all git-tracked (non-ignored) files in the project. */
export async function getGitTrackedFiles(
  projectRoot: string
): Promise<Set<string> | null> {
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
      for await (const file of glob.scan({ cwd: projectRoot, dot: false })) {
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
