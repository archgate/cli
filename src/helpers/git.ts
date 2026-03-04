import { $ } from "bun";
import { logDebug } from "./log";

export function installGit() {
  if (Bun.which("git")) {
    logDebug("Git is already installed");
    return;
  }
  console.log("Git is not installed. Installing...");
  if (process.platform === "darwin") return $`brew install git`;
  if (process.platform === "linux") return $`sudo apt-get install -y git`;
  if (process.platform === "win32")
    throw new Error(
      "Git is not installed. Install it from https://git-scm.com/download/win and make sure it is on your PATH."
    );
  throw new Error("Unsupported platform");
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
