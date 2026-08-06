// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  describe,
  expect,
  test,
  mock,
  spyOn,
  beforeEach,
  afterEach,
} from "bun:test";
import { rmSync } from "node:fs";
import { dirname } from "node:path";

import {
  type ArtifactInfo,
  downloadReleaseBinary,
} from "../../src/helpers/binary-upgrade";
import { rejectionMessage } from "../test-utils";

const TAR_ARTIFACT: ArtifactInfo = {
  name: "archgate-linux-x64",
  ext: ".tar.gz",
  binaryName: "archgate",
};

const ZIP_ARTIFACT: ArtifactInfo = {
  name: "archgate-win32-x64",
  ext: ".zip",
  binaryName: "archgate.exe",
};

const ENCODER = new TextEncoder();

function writeHeaderField(
  header: Uint8Array,
  offset: number,
  value: string
): void {
  header.set(ENCODER.encode(value), offset);
}

/**
 * Build a 512-byte ustar header for a zero-length regular file.
 *
 * `tar` refuses to *create* an archive whose member escapes the extraction
 * root, so an archive carrying such a member has to be assembled byte by byte.
 * That is the only shape that reaches the path-traversal guard.
 */
function tarHeader(name: string): Uint8Array {
  const header = new Uint8Array(512);
  writeHeaderField(header, 0, name);
  writeHeaderField(header, 100, "0000644\0");
  writeHeaderField(header, 108, "0000000\0");
  writeHeaderField(header, 116, "0000000\0");
  writeHeaderField(header, 124, "00000000000\0");
  writeHeaderField(header, 136, "00000000000\0");
  // The checksum is computed with its own field filled with spaces.
  writeHeaderField(header, 148, "        ");
  writeHeaderField(header, 156, "0");
  writeHeaderField(header, 257, "ustar\0");
  writeHeaderField(header, 263, "00");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeHeaderField(header, 148, checksum.toString(8).padStart(6, "0") + "\0 ");

  return header;
}

/** A gzipped tar holding the named entries, each an empty regular file. */
function buildTarGz(names: string[]): Uint8Array {
  // Two trailing zero blocks mark end-of-archive.
  const tar = new Uint8Array(names.length * 512 + 1024);
  names.forEach((name, index) => {
    tar.set(tarHeader(name), index * 512);
  });
  return Bun.gzipSync(tar);
}

/**
 * Serve `archive` as the release download and 404 the checksum request, so the
 * archive reaches extraction without a checksum to satisfy.
 */
function mockArchiveDownload(archive: Uint8Array): void {
  let callCount = 0;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  globalThis.fetch = mock(async () => {
    callCount++;
    if (callCount === 1) {
      const body = archive.buffer.slice(
        archive.byteOffset,
        archive.byteOffset + archive.byteLength
      );
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return {
        ok: true,
        arrayBuffer: async () => body,
        headers: new Headers(),
        body: null,
      } as Response;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return { ok: false, status: 404 } as Response;
  }) as unknown as typeof fetch;
}

describe("downloadReleaseBinary archive handling", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    // mock.restore() does not undo a direct assignment to globalThis.fetch.
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  // A backslash-separated escape (`..\evil`) has no row: GNU tar lists it with
  // the backslash escaped, so the guard's backslash normalization never sees
  // the shape it is written for. `test.skipIf(...).each()` also only accepts a
  // mutable row array, hence no `as const` here.
  const unsafeEntries: string[] = [
    "../evil",
    "pkg/../../evil",
    "/etc/cron.d/evil",
    "..",
  ];

  // The guard reads `tar -tzf` output, and GNU tar on Windows treats the
  // `C:\...` archive path as a remote host, so the listing never happens
  // there. Windows ships `.zip` releases and takes the PowerShell branch below.
  test.skipIf(process.platform === "win32").each(unsafeEntries)(
    "aborts extraction for the unsafe archive entry %s",
    async (entry) => {
      mockArchiveDownload(buildTarGz([entry]));

      const message = await rejectionMessage(
        downloadReleaseBinary("v1.0.0", TAR_ARTIFACT)
      );

      expect(message).toContain("Unsafe path in release archive");
      expect(message).toContain(entry);
    }
  );

  test.skipIf(process.platform === "win32")(
    "extracts an archive whose entries all stay inside the root",
    async () => {
      mockArchiveDownload(buildTarGz(["archgate", "nested/dir/file"]));

      const binaryPath = await downloadReleaseBinary("v1.0.0", TAR_ARTIFACT);
      try {
        expect(binaryPath).toEndWith("archgate");
      } finally {
        // downloadReleaseBinary extracts into its own mkdtemp directory.
        rmSync(dirname(binaryPath), { recursive: true, force: true });
      }
    }
  );

  test("reports the tar exit code when extraction fails", async () => {
    // Not a gzip stream at all: `tar -tzf` lists nothing, so the guard passes
    // and `tar -xzf` is what rejects it.
    mockArchiveDownload(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));

    const message = await rejectionMessage(
      downloadReleaseBinary("v1.0.0", TAR_ARTIFACT)
    );

    expect(message).toContain("Failed to extract archive (tar exit code");
  });

  test("reports the PowerShell exit code when zip extraction fails", async () => {
    mockArchiveDownload(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    // A corrupt archive does not produce a failing exit code here:
    // `Expand-Archive`'s error is non-terminating, so `powershell -Command`
    // still exits 0. Stubbing the spawn is what reaches the failure branch,
    // and it reaches it on every runner rather than only on Windows.
    const spawnSpy = spyOn(Bun, "spawn");
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    spawnSpy.mockImplementation((() => ({
      stdout: "",
      stderr: "Expand-Archive : Central Directory corrupt.",
      exited: Promise.resolve(3),
    })) as unknown as typeof Bun.spawn);

    const message = await rejectionMessage(
      downloadReleaseBinary("v1.0.0", ZIP_ARTIFACT)
    );

    expect(message).toBe("Failed to extract archive (PowerShell exit code 3)");
  });

  test("continues past checksum verification when the request fails", async () => {
    let callCount = 0;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return {
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(8),
          headers: new Headers(),
          body: null,
        } as Response;
      }
      throw new Error("checksum host unreachable");
    }) as unknown as typeof fetch;

    const message = await rejectionMessage(
      downloadReleaseBinary("v1.0.0", TAR_ARTIFACT)
    );

    // The transport failure is swallowed; the run proceeds to extraction.
    expect(message).not.toContain("checksum host unreachable");
    expect(message).toContain("Failed to extract archive");
  });
});
