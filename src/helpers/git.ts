// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { logDebug, logInfo } from "./log";
import { isWindows, isMacOS, resolveCommand } from "./platform";

/**
 * Ensure git is installed, installing via brew/apt when missing on Unix.
 *
 * Fast path: `Bun.which("git")` is a synchronous PATH lookup that short-circuits
 * when git is on PATH — which is the 99%+ case for everyone except first-run
 * users without git installed. This lets us skip the `resolveCommand` async
 * ceremony (and its WSL fallback subprocess on Windows) from the startup path.
 */
export async function installGit() {
  // Fast path: git on PATH — no subprocess, no await, no WSL fallback.
  if (Bun.which("git")) {
    logDebug("Git is already installed");
    return;
  }

  // Slow path: git wasn't found synchronously. Fall back to the full cross-env
  // resolver (handles WSL `.exe` lookups and WSL-from-Windows availability).
  if (await resolveCommand("git")) {
    logDebug("Git is already installed (cross-env)");
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
