// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
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
 * Run `cmd`, draining both pipes concurrently with the exit code.
 *
 * @see ARCH-007 — awaiting one pipe alone leaves the child blocked once it
 * fills the other, so `proc.exited` never resolves.
 */
async function runCapture(
  cmd: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export interface DownloadedBinary {
  /** Path to the extracted binary, inside {@link DownloadedBinary.tmpDir}. */
  binaryPath: string;
  /**
   * Extraction directory this call created. The caller removes it once the
   * binary is installed; deriving it from `binaryPath` instead would delete
   * whichever directory that path happens to sit in.
   */
  tmpDir: string;
}

/**
 * Download and extract the release binary to a temp directory.
 *
 * When an `onProgress` callback is provided the response body is streamed
 * so the caller can display incremental progress.  Without the callback the
 * response is buffered in one shot.
 *
 * @returns The extracted binary and the directory the caller must remove.
 */
export async function downloadReleaseBinary(
  tag: string,
  artifact: ArtifactInfo,
  onProgress?: DownloadProgressCallback
): Promise<DownloadedBinary> {
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
    logDebug("Extracting archive to:", tmpDir);

    if (artifact.ext === ".tar.gz") {
      // Bun.Archive confines every member to `tmpDir`: a leading `/` is
      // stripped, `../` segments are normalized away, and a bare `..` entry is
      // skipped. The previous `tar -tzf` scan approximated that containment by
      // parsing human-readable output, whose spelling differed between GNU tar
      // and bsdtar; the extractor enforcing it needs no listing at all.
      try {
        await new Bun.Archive(buffer).extract(tmpDir);
      } catch (err) {
        throw new UserError(
          `Failed to extract archive (${err instanceof Error ? err.message : String(err)})`
        );
      }
    } else {
      // Bun.Archive reads tar and tar.gz only, so the Windows `.zip` release
      // keeps PowerShell; switching the artifact to tar.gz would break every
      // shim, each of which downloads `.zip` for win32 (ARCH-017).
      // `-ErrorAction Stop` promotes Expand-Archive's non-terminating error to
      // a terminating one; without it PowerShell exits 0 on a corrupt archive.
      const archivePath = join(tmpDir, `archgate${artifact.ext}`);
      await Bun.write(archivePath, buffer);
      const { exitCode } = await runCapture([
        "powershell",
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}' -Force -ErrorAction Stop`,
      ]);
      if (exitCode !== 0) {
        throw new UserError(
          `Failed to extract archive (PowerShell exit code ${exitCode})`
        );
      }
    }

    const binaryPath = join(tmpDir, artifact.binaryName);
    // lstat rather than existsSync: the latter follows symlinks and accepts
    // directories, so an archive member that is either would be installed as
    // the binary. replaceBinary renames without following, so a symlink would
    // land in ~/.archgate/bin/ pointing wherever the archive chose.
    const stats = lstatSync(binaryPath, { throwIfNoEntry: false });
    if (!stats) {
      throw new UserError(
        `Extraction produced no ${artifact.binaryName} — the downloaded archive is corrupt or incomplete`
      );
    }
    if (!stats.isFile()) {
      throw new UserError(
        `Extraction produced ${artifact.binaryName} as a ${stats.isSymbolicLink() ? "symbolic link" : "non-regular file"} — refusing to install it`
      );
    }

    return { binaryPath, tmpDir };
  } catch (err) {
    // The caller learns of tmpDir only on success, so it can only clean up
    // then; every failure has to remove it here.
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
