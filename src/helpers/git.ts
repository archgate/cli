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
