// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
import { restoreEnv } from "../test-utils";

function mockFetch(handler: () => Promise<Response>) {
  // Deliberately incomplete fake: mock() can't reproduce fetch's full type
  // (preconnect etc.), and only the callable shape is ever exercised.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  globalThis.fetch = mock(handler) as unknown as typeof fetch;
}

describe("getManualInstallHint", () => {
  test.skipIf(process.platform !== "win32")(
    "returns Windows install command",
    () => {
      const hint = getManualInstallHint();
      expect(hint).toContain("install.ps1");
      expect(hint).toContain("irm");
    }
  );

  test.skipIf(process.platform === "win32")(
    "returns Unix install command",
    () => {
      const hint = getManualInstallHint();
      expect(hint).toContain("install.sh");
      expect(hint).toContain("curl");
    }
  );
});

describe("fetchLatestGitHubVersion", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    // mock.restore() does not undo a direct assignment to globalThis.fetch.
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("returns tag_name on success", async () => {
    mockFetch(async () => {
      // Deliberately incomplete fake Response: only the fields
      // fetchLatestGitHubVersion actually reads are given real values.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return {
        ok: true,
        json: async () => ({ tag_name: "v1.2.3" }),
      } as Response;
    });

    const result = await fetchLatestGitHubVersion();
    expect(result).toBe("v1.2.3");
  });

  test("returns null on non-ok response", async () => {
    mockFetch(async () => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return { ok: false, status: 403, json: async () => ({}) } as Response;
    });

    const result = await fetchLatestGitHubVersion();
    expect(result).toBeNull();
  });

  test("returns null when tag_name is missing", async () => {
    mockFetch(async () => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return { ok: true, json: async () => ({}) } as Response;
    });

    const result = await fetchLatestGitHubVersion();
    expect(result).toBeNull();
  });

  // A payload that parses as JSON but fails the release schema — the GitHub
  // API returning a non-string tag, or an error object in place of a release.
  const malformedPayloads = [
    ["a non-string tag_name", { tag_name: 42 }],
    ["a null tag_name", { tag_name: null }],
    ["an array payload", []],
  ] as const;

  test.each(malformedPayloads)(
    "returns null for %s",
    async (_label, payload) => {
      mockFetch(async () => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return { ok: true, json: async () => payload } as Response;
      });

      const result = await fetchLatestGitHubVersion();
      expect(result).toBeNull();
    }
  );
});

describe("downloadReleaseBinary", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    // mock.restore() does not undo a direct assignment to globalThis.fetch.
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("throws on HTTP error response", async () => {
    mockFetch(async () => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return { ok: false, status: 404 } as Response;
    });

    const artifact = {
      name: "archgate-linux-x64",
      ext: ".tar.gz",
      binaryName: "archgate",
    };

    expect(downloadReleaseBinary("v1.0.0", artifact)).rejects.toThrow(
      "Download failed (HTTP 404)"
    );
  });

  test("calls onProgress callback with streaming progress", async () => {
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
    // Deliberately incomplete fake Response/fetch: only the fields
    // downloadReleaseBinary actually reads are given real values.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return {
          ok: true,
          headers: new Headers({ "content-length": String(totalSize) }),
          body: stream,
        } as Response;
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return { ok: false, status: 404 } as Response;
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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return {
          ok: true,
          headers: new Headers(), // no content-length
          body: stream,
        } as Response;
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return { ok: false, status: 404 } as Response;
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

  test("throws on checksum mismatch", async () => {
    const archiveData = new Uint8Array([10, 20, 30, 40, 50]);
    const wrongHash = "0".repeat(64);
    let callCount = 0;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return {
          ok: true,
          arrayBuffer: async () => archiveData.buffer,
          headers: new Headers(),
          body: null,
        } as Response;
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return {
        ok: true,
        text: async () => `${wrongHash}  archgate-linux-x64.tar.gz`,
      } as Response;
    }) as unknown as typeof fetch;

    const artifact = {
      name: "archgate-linux-x64",
      ext: ".tar.gz" as const,
      binaryName: "archgate",
    };
    expect(downloadReleaseBinary("v1.0.0", artifact)).rejects.toThrow(
      "Checksum mismatch"
    );
  });

  test("passes checksum verification when hash matches", async () => {
    const archiveData = new Uint8Array([10, 20, 30, 40, 50]);
    const correctHash = createHash("sha256").update(archiveData).digest("hex");
    let callCount = 0;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return {
          ok: true,
          arrayBuffer: async () => archiveData.buffer,
          headers: new Headers(),
          body: null,
        } as Response;
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return {
        ok: true,
        text: async () => `${correctHash}  archgate-linux-x64.tar.gz`,
      } as Response;
    }) as unknown as typeof fetch;

    const artifact = {
      name: "archgate-linux-x64",
      ext: ".tar.gz" as const,
      binaryName: "archgate",
    };
    // Should pass checksum but fail at extraction (fake data)
    try {
      await downloadReleaseBinary("v1.0.0", artifact);
    } catch (err) {
      expect(String(err)).not.toContain("Checksum mismatch");
    }
  });

  test.skipIf(process.platform !== "win32")(
    "extracts zip archive on Windows via PowerShell",
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "archgate-dl-zip-test-"));
      writeFileSync(join(tmpDir, "archgate.exe"), "fake-binary-content");
      const zipPath = join(tmpDir, "test.zip");
      const zipProc = Bun.spawn(
        [
          "powershell",
          "-NoProfile",
          "-Command",
          `Compress-Archive -Path '${join(tmpDir, "archgate.exe")}' -DestinationPath '${zipPath}' -Force`,
        ],
        { stdout: "pipe", stderr: "pipe" }
      );
      await zipProc.exited;
      const zipBuffer = readFileSync(zipPath);
      const correctHash = createHash("sha256").update(zipBuffer).digest("hex");
      let callCount = 0;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      globalThis.fetch = mock(async () => {
        callCount++;
        if (callCount === 1) {
          const ab = zipBuffer.buffer.slice(
            zipBuffer.byteOffset,
            zipBuffer.byteOffset + zipBuffer.byteLength
          );
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          return {
            ok: true,
            arrayBuffer: async () => ab,
            headers: new Headers(),
            body: null,
          } as Response;
        }
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return {
          ok: true,
          text: async () => `${correctHash}  archgate-win32-x64.zip`,
        } as Response;
      }) as unknown as typeof fetch;
      const artifact = {
        name: "archgate-win32-x64",
        ext: ".zip" as const,
        binaryName: "archgate.exe",
      };
      try {
        const { binaryPath } = await downloadReleaseBinary("v1.0.0", artifact);
        expect(binaryPath).toContain("archgate.exe");
        expect(existsSync(binaryPath)).toBe(true);
      } finally {
        try {
          rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          /* cleanup guard */
        }
      }
    }
  );
});

describe("replaceBinary", () => {
  test.skipIf(process.platform === "win32")(
    "renames new binary to current path on non-Windows",
    () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "archgate-replace-test-"));
      const currentPath = join(tmpDir, "archgate");
      const newBinaryPath = join(tmpDir, "archgate.new");

      writeFileSync(currentPath, "old binary content");
      writeFileSync(newBinaryPath, "new binary content");

      replaceBinary(currentPath, newBinaryPath);

      // after replaceBinary, currentPath holds the new binary
      expect(existsSync(currentPath)).toBe(true);
      // and the staging path must be gone (rename, not copy)
      expect(existsSync(newBinaryPath)).toBe(false);

      const mode = statSync(currentPath).mode & 0o777;
      expect(mode).toBe(0o755);
    }
  );

  test.skipIf(process.platform !== "win32")(
    "creates .old file on Windows",
    () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "archgate-replace-test-"));
      const currentPath = join(tmpDir, "archgate.exe");
      const newBinaryPath = join(tmpDir, "archgate.exe.new");

      writeFileSync(currentPath, "old binary content");
      writeFileSync(newBinaryPath, "new binary content");

      replaceBinary(currentPath, newBinaryPath);

      expect(existsSync(currentPath)).toBe(true);
      expect(existsSync(currentPath + ".old")).toBe(true);
      expect(existsSync(newBinaryPath)).toBe(false);
    }
  );

  test("replaces file content with new binary", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "archgate-replace-test-"));
    const binaryName =
      process.platform === "win32" ? "archgate.exe" : "archgate";
    const currentPath = join(tmpDir, binaryName);
    const newBinaryPath = join(tmpDir, `${binaryName}.new`);

    writeFileSync(currentPath, "old binary content");
    writeFileSync(newBinaryPath, "new binary content");

    replaceBinary(currentPath, newBinaryPath);

    const content = readFileSync(currentPath, "utf8");
    expect(content).toBe("new binary content");
  });

  test.skipIf(process.platform !== "win32")(
    "cleans up leftover .old file from previous upgrade on Windows",
    () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "archgate-replace-test-"));
      const currentPath = join(tmpDir, "archgate.exe");
      const newBinaryPath = join(tmpDir, "archgate.exe.new");
      const oldPath = currentPath + ".old";

      // Pre-create a stale .old file from a previous upgrade
      writeFileSync(oldPath, "stale binary from previous upgrade");
      writeFileSync(currentPath, "old binary content");
      writeFileSync(newBinaryPath, "new binary content");

      replaceBinary(currentPath, newBinaryPath);

      // The old stale .old was cleaned up and replaced with the current binary
      expect(existsSync(currentPath)).toBe(true);
      expect(existsSync(oldPath)).toBe(true);
      expect(existsSync(newBinaryPath)).toBe(false);

      const oldContent = readFileSync(oldPath, "utf8");
      expect(oldContent).toBe("old binary content");
    }
  );
});

describe("cleanupStaleBinary", () => {
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = Bun.env.HOME;
  });

  afterEach(() => {
    restoreEnv("HOME", savedHome);
  });

  test.skipIf(getArtifactInfo() === null)(
    "deletes the .old binary when present",
    async () => {
      const artifact = getArtifactInfo()!;

      const tmpDir = mkdtempSync(join(tmpdir(), "archgate-cleanup-test-"));
      Bun.env.HOME = tmpDir;

      // Recreate the ~/.archgate/bin/ structure
      const binDir = join(tmpDir, ".archgate", "bin");
      mkdirSync(binDir, { recursive: true });
      const oldPath = join(binDir, `${artifact.binaryName}.old`);
      writeFileSync(oldPath, "stale binary");

      await cleanupStaleBinary();

      expect(existsSync(oldPath)).toBe(false);
    }
  );

  test.skipIf(getArtifactInfo() === null)(
    "resolves silently when no .old file exists",
    async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "archgate-cleanup-test-"));
      Bun.env.HOME = tmpDir;

      expect(cleanupStaleBinary()).resolves.toBeUndefined();
    }
  );
});
