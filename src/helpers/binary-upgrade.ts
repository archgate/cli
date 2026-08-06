// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReadableStreamDefaultReader } from "node:stream/web";

import { z } from "zod";

import { logDebug } from "./log";
import { internalPath } from "./paths";
import { isWindows } from "./platform";
import { UserError } from "./user-error";

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

const GitHubReleaseSchema = z.object({ tag_name: z.string().optional() });

const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/**
 * Fetch the latest version tag from GitHub Releases.
 *
 * @param timeoutMs Request timeout. Use a short value (e.g. 5s) for the
 *                  opportunistic background update check at CLI startup so
 *                  a slow network never delays the user's command. The
 *                  longer default (15s) is reserved for the explicit
 *                  `archgate upgrade` path where the user is waiting for it.
 * @returns The tag (e.g. "v0.13.1"), or null on failure.
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

  const result = GitHubReleaseSchema.safeParse(await response.json());
  if (!result.success) {
    logDebug("Failed to parse GitHub release response");
    return null;
  }
  logDebug("Latest release tag:", result.data.tag_name ?? "(none)");
  return result.data.tag_name ?? null;
}

// ---------------------------------------------------------------------------
// Download progress
// ---------------------------------------------------------------------------

export interface DownloadProgress {
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
 * response is buffered in one shot.
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
    // 5 minutes — release binaries can exceed 100 MB, which takes a while
    // on slower connections.
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    throw new UserError(`Download failed (HTTP ${response.status})`);
  }

  let buffer: ArrayBuffer;

  if (onProgress && response.body) {
    // Stream the response so we can report progress incrementally.
    const contentLength = response.headers.get("content-length");
    const totalBytes =
      contentLength !== null && contentLength !== ""
        ? Math.trunc(Number(contentLength))
        : null;

    // undici-types declares `Response.body` as the bare `node:stream/web`
    // `ReadableStream` with no type parameter, so `.getReader()` infers
    // `ReadableStreamDefaultReader<any>` — narrow to the same module's
    // reader type, parameterized with the type actually read from it.
    const rawReader = response.body.getReader();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- source is `any` at this untyped-generic library boundary; this is what it actually returns
    const reader = rawReader as ReadableStreamDefaultReader<Uint8Array>;
    const chunks: Uint8Array[] = [];
    let downloadedBytes = 0;

    for (;;) {
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
    buffer = combined.buffer.slice(
      combined.byteOffset,
      combined.byteOffset + combined.byteLength
    );
  } else {
    buffer = await response.arrayBuffer();
  }

  logDebug("Downloaded", Math.round(buffer.byteLength / 1024), "KB");

  // Verify the SHA256 checksum when the release publishes one
  try {
    const checksumResponse = await fetch(checksumUrl, {
      headers: { "User-Agent": "archgate-cli" },
      signal: AbortSignal.timeout(15000),
    });
    if (checksumResponse.ok) {
      const checksumText = await checksumResponse.text();
      const expectedHash = checksumText.trim().split(/\s+/u)[0].toLowerCase();
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
  try {
    const archivePath = join(tmpDir, `archgate${artifact.ext}`);
    logDebug("Extracting archive to:", tmpDir);

    await Bun.write(archivePath, buffer);

    if (artifact.ext === ".tar.gz") {
      // Validate archive entries before extraction to prevent path traversal.
      // Backslashes are normalized because a member stored as `..\evil` is
      // listed escaped by GNU tar and literal by bsdtar; both forms reach the
      // `../` check only after normalization.
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
        throw new UserError(
          `Failed to extract archive (tar exit code ${exitCode})`
        );
      }
    } else {
      // `-ErrorAction Stop` promotes Expand-Archive's non-terminating error to
      // a terminating one; without it PowerShell exits 0 on a corrupt archive
      // and extraction failure goes unnoticed.
      const proc = Bun.spawn(
        [
          "powershell",
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}' -Force -ErrorAction Stop`,
        ],
        { stdout: "pipe", stderr: "pipe" }
      );
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new UserError(
          `Failed to extract archive (PowerShell exit code ${exitCode})`
        );
      }
    }

    const binaryPath = join(tmpDir, artifact.binaryName);
    if (!existsSync(binaryPath)) {
      throw new UserError(
        `Extraction produced no ${artifact.binaryName} — the downloaded archive is corrupt or incomplete`
      );
    }

    return binaryPath;
  } catch (err) {
    // The caller only receives a path on success, so it can only clean up the
    // extraction directory then; every failure has to remove it here.
    rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }
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
 * Attempt to delete the leftover `.old` binary from a prior upgrade. On
 * Windows the running exe is file-locked, so `replaceBinary()` renames it to
 * `.old`; it is unlocked by the next CLI invocation, which is when this
 * runs. Call once at CLI startup, fire-and-forget — errors are swallowed
 * because cleanup is best-effort and must never affect the user's command.
 */
export async function cleanupStaleBinary(): Promise<void> {
  const artifact = getArtifactInfo();
  if (!artifact) return;

  const oldPath = internalPath("bin", `${artifact.binaryName}.old`);
  await unlink(oldPath).catch(() => {
    // File absent or still locked — nothing to do.
  });
}

export function getManualInstallHint(): string {
  return isWindows()
    ? "irm https://raw.githubusercontent.com/archgate/cli/main/install.ps1 | iex"
    : "curl -fsSL https://raw.githubusercontent.com/archgate/cli/main/install.sh | sh";
}
