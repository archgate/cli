/**
 * Unit tests for the archgate npm shim.
 * Uses the Node.js built-in test runner (node:test) — zero dependencies.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  getArtifactName,
  getBinaryName,
  getArchiveExt,
  getCacheDir,
  stripNulls,
  verifySha256,
} = require("../archgate.cjs");

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

describe("getArtifactName", () => {
  it("darwin/arm64 → archgate-darwin-arm64", () => {
    assert.equal(getArtifactName("darwin", "arm64"), "archgate-darwin-arm64");
  });

  it("linux/x64 → archgate-linux-x64", () => {
    assert.equal(getArtifactName("linux", "x64"), "archgate-linux-x64");
  });

  it("win32/x64 → archgate-win32-x64", () => {
    assert.equal(getArtifactName("win32", "x64"), "archgate-win32-x64");
  });

  it("throws on unsupported platform", () => {
    assert.throws(() => getArtifactName("freebsd", "x64"), {
      message: /Unsupported platform/u,
    });
  });

  it("throws on unsupported arch", () => {
    assert.throws(() => getArtifactName("linux", "arm"), {
      message: /Unsupported platform/u,
    });
  });

  it("covers all three supported artifacts", () => {
    const artifacts = new Set([
      getArtifactName("darwin", "arm64"),
      getArtifactName("linux", "x64"),
      getArtifactName("win32", "x64"),
    ]);
    assert.equal(artifacts.size, 3);
    assert.ok(artifacts.has("archgate-darwin-arm64"));
    assert.ok(artifacts.has("archgate-linux-x64"));
    assert.ok(artifacts.has("archgate-win32-x64"));
  });
});

// ---------------------------------------------------------------------------
// Binary name
// ---------------------------------------------------------------------------

describe("getBinaryName", () => {
  it("returns archgate.exe on Windows", () => {
    assert.equal(getBinaryName("win32"), "archgate.exe");
  });

  it("returns archgate on macOS", () => {
    assert.equal(getBinaryName("darwin"), "archgate");
  });

  it("returns archgate on Linux", () => {
    assert.equal(getBinaryName("linux"), "archgate");
  });
});

// ---------------------------------------------------------------------------
// Archive extension
// ---------------------------------------------------------------------------

describe("getArchiveExt", () => {
  it("returns zip on Windows", () => {
    assert.equal(getArchiveExt("win32"), "zip");
  });

  it("returns tar.gz on macOS", () => {
    assert.equal(getArchiveExt("darwin"), "tar.gz");
  });

  it("returns tar.gz on Linux", () => {
    assert.equal(getArchiveExt("linux"), "tar.gz");
  });
});

// ---------------------------------------------------------------------------
// Cache directory
// ---------------------------------------------------------------------------

describe("getCacheDir", () => {
  it("returns a non-empty path", () => {
    const dir = getCacheDir();
    assert.ok(dir.length > 0);
  });

  it("ends with .archgate/bin", () => {
    const dir = getCacheDir();
    assert.ok(
      dir.endsWith(".archgate/bin") || dir.endsWith(".archgate\\bin"),
      `Expected path to end with .archgate/bin, got: ${dir}`
    );
  });
});

// ---------------------------------------------------------------------------
// stripNulls
// ---------------------------------------------------------------------------

describe("stripNulls", () => {
  it("strips trailing null bytes", () => {
    assert.equal(stripNulls("hello\0\0\0"), "hello");
  });

  it("returns original string when no nulls present", () => {
    assert.equal(stripNulls("hello"), "hello");
  });

  it("returns empty string when first char is null", () => {
    assert.equal(stripNulls("\0rest"), "");
  });

  it("handles empty string", () => {
    assert.equal(stripNulls(""), "");
  });
});

// ---------------------------------------------------------------------------
// SHA-256 checksum verification
// ---------------------------------------------------------------------------

describe("verifySha256", () => {
  it("passes when checksum matches", async () => {
    const data = Buffer.from("hello archgate");
    const expectedHash = crypto.createHash("sha256").update(data).digest("hex");
    const checksumContent = Buffer.from(
      `${expectedHash}  archgate-linux-x64.tar.gz\n`
    );

    // Should not throw
    await verifySha256(data, "https://example.com/checksum", "1.0.0", () =>
      Promise.resolve(checksumContent)
    );
  });

  it("throws when checksum does not match", async () => {
    const data = Buffer.from("hello archgate");
    const wrongHash = crypto
      .createHash("sha256")
      .update(Buffer.from("wrong data"))
      .digest("hex");
    const checksumContent = Buffer.from(
      `${wrongHash}  archgate-linux-x64.tar.gz\n`
    );

    await assert.rejects(
      () =>
        verifySha256(data, "https://example.com/checksum", "1.0.0", () =>
          Promise.resolve(checksumContent)
        ),
      { message: /checksum verification failed/u }
    );
  });

  it("warns but does not throw when checksum file is unavailable", async () => {
    const data = Buffer.from("hello archgate");

    // Should not throw — just warns to stderr
    await verifySha256(data, "https://example.com/checksum", "1.0.0", () =>
      Promise.reject(new Error("404 Not Found"))
    );
  });
});
