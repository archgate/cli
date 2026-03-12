/** Git file-listing utilities for ADR scope resolution and change detection. */

/**
 * Run a git command using Bun.spawn (cross-platform, no shell).
 * Bun.$ hangs on Windows due to pipe handling issues — this is the safe alternative.
 */
async function runGit(args: string[], cwd: string): Promise<string> {
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
    return new Set(result.trim().split("\n").filter(Boolean));
  } catch {
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
  const allFiles: string[] = [];

  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern);
    // oxlint-disable-next-line no-await-in-loop -- async iterator
    for await (const file of glob.scan({ cwd: projectRoot, dot: false })) {
      const normalized = file.replaceAll("\\", "/");
      if (trackedFiles && !trackedFiles.has(normalized)) continue;
      if (!allFiles.includes(normalized)) allFiles.push(normalized);
    }
  }
  return allFiles.sort();
}

/** Get changed files from git staging area. */
export async function getStagedFiles(projectRoot: string): Promise<string[]> {
  try {
    const result = await runGit(
      ["diff", "--cached", "--name-only"],
      projectRoot
    );
    return result.trim().split("\n").filter(Boolean);
  } catch {
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
    return [...all].sort();
  } catch {
    return [];
  }
}
