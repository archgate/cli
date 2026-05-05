import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, renameSync, unlinkSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { logDebug } from "./log";
import { internalPath } from "./paths";
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
 *
 * @param timeoutMs Request timeout. Use a short value (e.g. 5s) for the
 *                  opportunistic background update check at CLI startup so
 *                  a slow network never delays the user's command. The
 *                  longer default (15s) is reserved for the explicit
 *                  `archgate upgrade` path where the user is waiting for it.
 */
export async function fetchLatestGitHubVersion(
  timeoutMs = 15_000
): Promise<string | null> {
  logDebug("Fetching latest release from:", GITHUB_RELEASES_API);
  const response = await fetch(GITHUB_RELEASES_API, {
    headers: { "User-Agent": "archgate-cli" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    logDebug("GitHub API response not ok, status:", response.status);
    return null;
  }

  const data = (await response.json()) as GitHubRelease;
  logDebug("Latest release tag:", data.tag_name ?? "(none)");
  return data.tag_name ?? null;
}

// ---------------------------------------------------------------------------
// Download progress
// ---------------------------------------------------------------------------

export interface DownloadProgress {
  /** Bytes received so far. */
  downloadedBytes: number;
  /** Total expected bytes (`null` when Content-Length is absent). */
  totalBytes: number | null;
}

export type DownloadProgressCallback = (progress: DownloadProgress) => void;

// ---------------------------------------------------------------------------
// Download and extract
// ---------------------------------------------------------------------------

/**
 * Download and extract the release binary to a temp directory.
 * Returns the path to the extracted binary.
 *
 * When an `onProgress` callback is provided the response body is streamed
 * so the caller can display incremental progress.  Without the callback the
 * response is buffered in one shot (legacy behaviour).
 */
export async function downloadReleaseBinary(
  tag: string,
  artifact: ArtifactInfo,
  onProgress?: DownloadProgressCallback
): Promise<string> {
  const baseUrl = `https://github.com/${GITHUB_REPO}/releases/download/${tag}`;
  const archiveUrl = `${baseUrl}/${artifact.name}${artifact.ext}`;
  const checksumUrl = `${baseUrl}/${artifact.name}${artifact.ext}.sha256`;

  logDebug("Downloading binary from:", archiveUrl);
  const response = await fetch(archiveUrl, {
    headers: { "User-Agent": "archgate-cli" },
    // 5 minutes — release binaries can exceed 100 MB which may take a
    // while on slower connections.  The previous 60 s limit caused
    // timeouts for many users.
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    throw new Error(`Download failed (HTTP ${response.status})`);
  }

  let buffer: ArrayBuffer;

  if (onProgress && response.body) {
    // Stream the response so we can report progress incrementally.
    const contentLength = response.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : null;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let downloadedBytes = 0;

    while (true) {
      // oxlint-disable-next-line no-await-in-loop -- sequential streaming is intentional; each chunk depends on the previous read
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      downloadedBytes += value.byteLength;
      onProgress({ downloadedBytes, totalBytes });
    }

    // Combine chunks into a single contiguous buffer.
    const combined = new Uint8Array(downloadedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    buffer = combined.buffer as ArrayBuffer;
  } else {
    buffer = await response.arrayBuffer();
  }

  logDebug("Downloaded", Math.round(buffer.byteLength / 1024), "KB");

  // Verify SHA256 checksum when available (releases after this change)
  try {
    const checksumResponse = await fetch(checksumUrl, {
      headers: { "User-Agent": "archgate-cli" },
      signal: AbortSignal.timeout(15000),
    });
    if (checksumResponse.ok) {
      const checksumText = await checksumResponse.text();
      const expectedHash = checksumText.trim().split(/\s+/)[0].toLowerCase();
      const actualHash = createHash("sha256")
        .update(new Uint8Array(buffer))
        .digest("hex");
      if (actualHash !== expectedHash) {
        throw new Error(
          `Checksum mismatch for ${artifact.name}${artifact.ext}: expected ${expectedHash}, got ${actualHash}`
        );
      }
      logDebug("Checksum verified:", actualHash);
    } else {
      logDebug("No checksum file available — skipping verification");
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Checksum mismatch")) {
      throw err;
    }
    logDebug("Checksum verification skipped:", err);
  }
  const tmpDir = mkdtempSync(join(tmpdir(), "archgate-upgrade-"));
  const archivePath = join(tmpDir, `archgate${artifact.ext}`);
  logDebug("Extracting archive to:", tmpDir);

  await Bun.write(archivePath, buffer);

  if (artifact.ext === ".tar.gz") {
    // Validate archive entries before extraction to prevent path traversal
    const listProc = Bun.spawn(["tar", "-tzf", archivePath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const listing = await new Response(listProc.stdout).text();
    await listProc.exited;

    for (const entry of listing.split("\n").filter(Boolean)) {
      const normalized = entry.replaceAll("\\", "/").trim();
      if (
        normalized.startsWith("/") ||
        normalized.includes("../") ||
        normalized === ".."
      ) {
        throw new Error(
          `Unsafe path in release archive: "${entry}" — aborting extraction`
        );
      }
    }

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
 * Windows: renames the running exe to .old (allowed by the OS), then moves the
 * new one into place.  The .old file is cleaned up on the next CLI startup via
 * {@link cleanupStaleBinary}.
 */
export function replaceBinary(
  currentPath: string,
  newBinaryPath: string
): void {
  logDebug("Replacing binary:", currentPath, "with:", newBinaryPath);
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

    // The .old file is still locked by the running process so it cannot be
    // deleted right now.  cleanupStaleBinary() will remove it on the next
    // CLI invocation when the file is guaranteed to be unlocked.
  } else {
    renameSync(newBinaryPath, currentPath);
    chmodSync(currentPath, 0o755);
  }
}

// ---------------------------------------------------------------------------
// Stale binary cleanup
// ---------------------------------------------------------------------------

/**
 * Attempt to delete the leftover `.old` binary from a previous upgrade.
 *
 * On Windows, `replaceBinary()` renames the running exe to `.old` because the
 * OS file-locks the running binary.  The `.old` file cannot be deleted during
 * that same process — but it is guaranteed to be unlocked by the time the
 * *next* CLI invocation starts.
 *
 * The cleanup is platform-agnostic: it resolves the correct binary name for
 * the current platform and attempts to remove `<binary>.old` from the install
 * directory.  On Unix the `.old` file is unlikely to exist (rename is atomic),
 * but running the check everywhere keeps the logic unified.
 *
 * Call this once at CLI startup (fire-and-forget, no `await`).  Errors are
 * silently swallowed — cleanup is best-effort and must never affect the
 * user's command.
 */
export function cleanupStaleBinary(): Promise<void> {
  const artifact = getArtifactInfo();
  if (!artifact) return Promise.resolve();

  const oldPath = internalPath("bin", `${artifact.binaryName}.old`);
  return unlink(oldPath).catch(() => {
    // File absent or still locked — nothing to do.
  });
}

/**
 * Returns the manual install hint for the current platform.
 */
export function getManualInstallHint(): string {
  return isWindows()
    ? "irm https://raw.githubusercontent.com/archgate/cli/main/install.ps1 | iex"
    : "curl -fsSL https://raw.githubusercontent.com/archgate/cli/main/install.sh | sh";
}
