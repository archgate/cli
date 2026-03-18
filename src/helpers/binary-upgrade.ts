import { chmodSync, mkdtempSync, renameSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isWindows } from "./platform";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_REPO = "archgate/cli";

// ---------------------------------------------------------------------------
// Artifact resolution
// ---------------------------------------------------------------------------

export interface ArtifactInfo {
  /** e.g. "archgate-darwin-arm64" */
  name: string;
  /** e.g. ".tar.gz" or ".zip" */
  ext: string;
  /** e.g. "archgate" or "archgate.exe" */
  binaryName: string;
}

export function getArtifactInfo(): ArtifactInfo | null {
  const { platform, arch } = process;

  if (platform === "darwin" && arch === "arm64") {
    return {
      name: "archgate-darwin-arm64",
      ext: ".tar.gz",
      binaryName: "archgate",
    };
  }
  if (platform === "linux" && arch === "x64") {
    return {
      name: "archgate-linux-x64",
      ext: ".tar.gz",
      binaryName: "archgate",
    };
  }
  if (platform === "win32" && arch === "x64") {
    return {
      name: "archgate-win32-x64",
      ext: ".zip",
      binaryName: "archgate.exe",
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Version fetching
// ---------------------------------------------------------------------------

interface GitHubRelease {
  tag_name?: string;
}

const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/**
 * Fetch the latest version tag from GitHub Releases.
 * Returns the tag (e.g. "v0.13.1") or null on failure.
 */
export async function fetchLatestGitHubVersion(): Promise<string | null> {
  const response = await fetch(GITHUB_RELEASES_API, {
    headers: { "User-Agent": "archgate-cli" },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as GitHubRelease;
  return data.tag_name ?? null;
}

// ---------------------------------------------------------------------------
// Download and extract
// ---------------------------------------------------------------------------

/**
 * Download and extract the release binary to a temp directory.
 * Returns the path to the extracted binary.
 */
export async function downloadReleaseBinary(
  tag: string,
  artifact: ArtifactInfo
): Promise<string> {
  const archiveUrl = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${artifact.name}${artifact.ext}`;

  const response = await fetch(archiveUrl, {
    headers: { "User-Agent": "archgate-cli" },
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    throw new Error(`Download failed (HTTP ${response.status})`);
  }

  const buffer = await response.arrayBuffer();
  const tmpDir = mkdtempSync(join(tmpdir(), "archgate-upgrade-"));
  const archivePath = join(tmpDir, `archgate${artifact.ext}`);

  await Bun.write(archivePath, buffer);

  if (artifact.ext === ".tar.gz") {
    const proc = Bun.spawn(["tar", "-xzf", archivePath, "-C", tmpDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`Failed to extract archive (tar exit code ${exitCode})`);
    }
  } else {
    const proc = Bun.spawn(
      [
        "powershell",
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}' -Force`,
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(
        `Failed to extract archive (PowerShell exit code ${exitCode})`
      );
    }
  }

  return join(tmpDir, artifact.binaryName);
}

// ---------------------------------------------------------------------------
// Binary replacement
// ---------------------------------------------------------------------------

/**
 * Replace the running binary with the new one.
 *
 * Unix: directly renames the new binary over the old one (OS handles inode unlinking).
 * Windows: renames the running exe to .old (allowed by the OS), moves the new one
 * into place, and spawns a detached cleanup process for the old file.
 */
export function replaceBinary(
  currentPath: string,
  newBinaryPath: string
): void {
  if (isWindows()) {
    const oldPath = currentPath + ".old";

    // Clean up leftover .old file from a previous upgrade
    try {
      unlinkSync(oldPath);
    } catch {
      // Not present — fine
    }

    renameSync(currentPath, oldPath);
    renameSync(newBinaryPath, currentPath);

    // Spawn detached cleanup — waits for this process to exit, then deletes the old file
    Bun.spawn(["cmd", "/c", `ping -n 2 127.0.0.1 >nul & del "${oldPath}"`], {
      stdout: "ignore",
      stderr: "ignore",
    });
  } else {
    renameSync(newBinaryPath, currentPath);
    chmodSync(currentPath, 0o755);
  }
}

/**
 * Returns the manual install hint for the current platform.
 */
export function getManualInstallHint(): string {
  return isWindows()
    ? "irm https://raw.githubusercontent.com/archgate/cli/main/install.ps1 | iex"
    : "curl -fsSL https://raw.githubusercontent.com/archgate/cli/main/install.sh | sh";
}
