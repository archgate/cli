/** Git file-listing utilities for ADR scope resolution and change detection. */

/** Get all git-tracked (non-ignored) files in the project. */
export async function getGitTrackedFiles(
  projectRoot: string
): Promise<Set<string> | null> {
  try {
    const result =
      await Bun.$`git ls-files --cached --others --exclude-standard`
        .cwd(projectRoot)
        .quiet()
        .text();
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
      if (trackedFiles && !trackedFiles.has(file)) continue;
      if (!allFiles.includes(file)) allFiles.push(file);
    }
  }
  return allFiles.sort();
}

/** Get changed files from git staging area. */
export async function getStagedFiles(projectRoot: string): Promise<string[]> {
  try {
    const result = await Bun.$`git diff --cached --name-only`
      .cwd(projectRoot)
      .quiet()
      .text();
    return result.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** Get all changed files (staged + unstaged). */
export async function getChangedFiles(projectRoot: string): Promise<string[]> {
  try {
    const staged = await Bun.$`git diff --cached --name-only`
      .cwd(projectRoot)
      .quiet()
      .text();
    const unstaged = await Bun.$`git diff --name-only`
      .cwd(projectRoot)
      .quiet()
      .text();
    const all = new Set([
      ...staged.trim().split("\n").filter(Boolean),
      ...unstaged.trim().split("\n").filter(Boolean),
    ]);
    return [...all].sort();
  } catch {
    return [];
  }
}
