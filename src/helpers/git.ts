import { logDebug, logInfo } from "./log";
import { isWindows, isMacOS, resolveCommand } from "./platform";

export async function installGit() {
  if (await resolveCommand("git")) {
    logDebug("Git is already installed");
    return;
  }
  logInfo("Git is not installed. Installing...");
  if (isWindows()) {
    throw new Error(
      "Git is not installed. Install it from https://git-scm.com/download/win and make sure it is on your PATH."
    );
  }
  const cmd = isMacOS()
    ? ["brew", "install", "git"]
    : ["sudo", "apt-get", "install", "-y", "git"];
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to install git (exit code ${exitCode})`);
  }
}

/**
 * Get list of changed files (unstaged + staged) relative to project root.
 */
export async function getChangedFiles(projectRoot: string): Promise<string[]> {
  try {
    const spawnOpts = {
      cwd: projectRoot,
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    };
    const unstaged = Bun.spawn(["git", "diff", "--name-only"], spawnOpts);
    const staged = Bun.spawn(
      ["git", "diff", "--cached", "--name-only"],
      spawnOpts
    );
    const [unstagedText, stagedText] = await Promise.all([
      new Response(unstaged.stdout).text(),
      new Response(staged.stdout).text(),
    ]);
    await Promise.all([unstaged.exited, staged.exited]);
    const files = [
      ...unstagedText.trim().split("\n"),
      ...stagedText.trim().split("\n"),
    ].filter(Boolean);
    return [...new Set(files)];
  } catch {
    return [];
  }
}
