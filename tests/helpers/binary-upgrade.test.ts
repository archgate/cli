// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type DownloadProgressCallback,
  cleanupStaleBinary,
  getArtifactInfo,
  getManualInstallHint,
  fetchLatestGitHubVersion,
  downloadReleaseBinary,
  replaceBinary,
} from "../../src/helpers/binary-upgrade";

function mockFetch(handler: () => Promise<Response>) {
  globalThis.fetch = mock(handler) as unknown as typeof fetch;
}

describe("getArtifactInfo", () => {
  test("returns artifact info for the current platform", () => {
    const info = getArtifactInfo();

    // Should return non-null for any supported CI platform
    if (info === null) return;

    expect(info.name).toMatch(/^archgate-(darwin-arm64|linux-x64|win32-x64)$/u);
    expect(info.ext).toMatch(/^\.(tar\.gz|zip)$/u);
    expect(info.binaryName).toMatch(/^archgate(\.exe)?$/u);
  });

  test("returns .zip extension for win32", () => {
    const info = getArtifactInfo();
    if (process.platform !== "win32") return;
    expect(info).not.toBeNull();
    expect(info!.ext).toBe(".zip");
    expect(info!.binaryName).toBe("archgate.exe");
    expect(info!.name).toBe("archgate-win32-x64");
  });

  test("returns .tar.gz extension for non-win32", () => {
    const info = getArtifactInfo();
    if (process.platform === "win32") return;
    expect(info).not.toBeNull();
    expect(info!.ext).toBe(".tar.gz");
    expect(info!.binaryName).toBe("archgate");
  });
});

describe("getManualInstallHint", () => {
  test("returns platform-appropriate install command", () => {
    const hint = getManualInstallHint();

    if (process.platform === "win32") {
      expect(hint).toContain("install.ps1");
      expect(hint).toContain("irm");
    } else {
      expect(hint).toContain("install.sh");
      expect(hint).toContain("curl");
    }
  });
});

describe("fetchLatestGitHubVersion", () => {
  afterEach(() => {
    mock.restore();
  });

  test("returns tag_name on success", async () => {
    mockFetch(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v1.2.3" }),
      } as Response)
    );

    const result = await fetchLatestGitHubVersion();
    expect(result).toBe("v1.2.3");
  });

  test("returns null on non-ok response", async () => {
    mockFetch(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        json: () => Promise.resolve({}),
      } as Response)
    );

    const result = await fetchLatestGitHubVersion();
    expect(result).toBeNull();
  });

  test("returns null when tag_name is missing", async () => {
    mockFetch(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
    );

    const result = await fetchLatestGitHubVersion();
    expect(result).toBeNull();
  });
});

describe("downloadReleaseBinary", () => {
  afterEach(() => {
    mock.restore();
  });

  test("throws on HTTP error response", async () => {
    mockFetch(() => Promise.resolve({ ok: false, status: 404 } as Response));

    const artifact = {
      name: "archgate-linux-x64",
      ext: ".tar.gz",
      binaryName: "archgate",
    };

    await expect(downloadReleaseBinary("v1.0.0", artifact)).rejects.toThrow(
      "Download failed (HTTP 404)"
    );
  });

  test("calls onProgress callback with streaming progress", async () => {
    // Create a fake ReadableStream that yields two chunks
    const chunk1 = new Uint8Array([1, 2, 3, 4]);
    const chunk2 = new Uint8Array([5, 6, 7, 8, 9, 10]);
    const totalSize = chunk1.byteLength + chunk2.byteLength;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });

    // First call: archive download (with streaming body)
    // Second call: checksum fetch (returns 404 — skipped)
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-length": String(totalSize) }),
          body: stream,
        } as Response);
      }
      // Checksum fetch — not available
      return Promise.resolve({ ok: false, status: 404 } as Response);
    }) as unknown as typeof fetch;

    const progressCalls: Array<{
      downloadedBytes: number;
      totalBytes: number | null;
    }> = [];
    const onProgress: DownloadProgressCallback = (info) => {
      progressCalls.push({ ...info });
    };

    const artifact = {
      name: "archgate-linux-x64",
      ext: ".tar.gz",
      binaryName: "archgate",
    };

    // downloadReleaseBinary will fail at extraction (no real tar),
    // but progress callbacks should still have been called.
    try {
      await downloadReleaseBinary("v1.0.0", artifact, onProgress);
    } catch {
      // Expected — the fake data is not a valid archive
    }

    expect(progressCalls).toHaveLength(2);

    expect(progressCalls[0].downloadedBytes).toBe(chunk1.byteLength);
    expect(progressCalls[0].totalBytes).toBe(totalSize);

    expect(progressCalls[1].downloadedBytes).toBe(totalSize);
    expect(progressCalls[1].totalBytes).toBe(totalSize);
  });

  test("streams without totalBytes when content-length is absent", async () => {
    const chunk = new Uint8Array([1, 2, 3]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });

    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          headers: new Headers(), // no content-length
          body: stream,
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    }) as unknown as typeof fetch;

    const progressCalls: Array<{
      downloadedBytes: number;
      totalBytes: number | null;
    }> = [];

    const artifact = {
      name: "archgate-linux-x64",
      ext: ".tar.gz",
      binaryName: "archgate",
    };

    try {
      await downloadReleaseBinary("v1.0.0", artifact, (info) => {
        progressCalls.push({ ...info });
      });
    } catch {
      // Expected — fake data is not a valid archive
    }

    expect(progressCalls).toHaveLength(1);
    expect(progressCalls[0].downloadedBytes).toBe(chunk.byteLength);
    expect(progressCalls[0].totalBytes).toBeNull();
  });
});

describe("replaceBinary", () => {
  test("renames new binary to current path on non-Windows", () => {
    if (process.platform === "win32") return;

    const tmpDir = mkdtempSync(join(tmpdir(), "archgate-replace-test-"));
    const currentPath = join(tmpDir, "archgate");
    const newBinaryPath = join(tmpDir, "archgate.new");

    // Create placeholder files
    writeFileSync(currentPath, "old binary content");
    writeFileSync(newBinaryPath, "new binary content");

    replaceBinary(currentPath, newBinaryPath);

    // new binary should have been renamed to currentPath
    expect(existsSync(currentPath)).toBe(true);
    // the new binary path should no longer exist (it was renamed)
    expect(existsSync(newBinaryPath)).toBe(false);

    // verify chmod 755 was applied
    const mode = statSync(currentPath).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  test("creates .old file on Windows", () => {
    if (process.platform !== "win32") return;

    const tmpDir = mkdtempSync(join(tmpdir(), "archgate-replace-test-"));
    const currentPath = join(tmpDir, "archgate.exe");
    const newBinaryPath = join(tmpDir, "archgate.exe.new");

    writeFileSync(currentPath, "old binary content");
    writeFileSync(newBinaryPath, "new binary content");

    replaceBinary(currentPath, newBinaryPath);

    expect(existsSync(currentPath)).toBe(true);
    expect(existsSync(currentPath + ".old")).toBe(true);
    expect(existsSync(newBinaryPath)).toBe(false);
  });
});

describe("cleanupStaleBinary", () => {
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = Bun.env.HOME;
  });

  afterEach(() => {
    Bun.env.HOME = savedHome;
  });

  test("deletes the .old binary when present", async () => {
    const artifact = getArtifactInfo();
    if (!artifact) return; // unsupported platform

    const tmpDir = mkdtempSync(join(tmpdir(), "archgate-cleanup-test-"));
    Bun.env.HOME = tmpDir;

    // Recreate the ~/.archgate/bin/ structure
    const binDir = join(tmpDir, ".archgate", "bin");
    mkdirSync(binDir, { recursive: true });
    const oldPath = join(binDir, `${artifact.binaryName}.old`);
    writeFileSync(oldPath, "stale binary");

    await cleanupStaleBinary();

    expect(existsSync(oldPath)).toBe(false);
  });

  test("resolves silently when no .old file exists", async () => {
    const artifact = getArtifactInfo();
    if (!artifact) return; // unsupported platform

    const tmpDir = mkdtempSync(join(tmpdir(), "archgate-cleanup-test-"));
    Bun.env.HOME = tmpDir;

    // No .old file — should not throw
    await expect(cleanupStaleBinary()).resolves.toBeUndefined();
  });
});
