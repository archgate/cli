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
  throw new Error("Unsupported platform");
}

/**
 * Get list of changed files (unstaged + staged) relative to project root.
 */
export async function getChangedFiles(projectRoot: string): Promise<string[]> {
  try {
    const result =
      await $`git diff --name-only && git diff --cached --name-only`
        .cwd(projectRoot)
        .quiet()
        .text();
    const files = result.trim().split("\n").filter(Boolean);
    return [...new Set(files)];
  } catch {
    return [];
  }
}
