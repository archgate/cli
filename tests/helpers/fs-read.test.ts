// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readIfExists, readTextIfExists } from "../../src/helpers/fs-read";
import { safeRmSync } from "../test-utils";

describe("readTextIfExists", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "archgate-fs-read-"));
  });

  afterEach(() => {
    safeRmSync(dir);
  });

  test("returns the file's text when it exists", async () => {
    const file = join(dir, "present.txt");
    writeFileSync(file, "hello\nworld\n");
    expect(await readTextIfExists(file)).toBe("hello\nworld\n");
  });

  test("returns an empty string for an existing empty file", async () => {
    // "" and null must not collapse: a caller reading null as "missing" would
    // otherwise misreport a file that is present but empty.
    const file = join(dir, "empty.txt");
    writeFileSync(file, "");
    expect(await readTextIfExists(file)).toBe("");
  });

  // The regression this helper exists for: a missing file must settle the
  // promise. Were it to hang, this test would time out rather than fail.
  test("returns null when the file does not exist", async () => {
    expect(await readTextIfExists(join(dir, "absent.txt"))).toBeNull();
  });

  test("returns null when the path is a directory", async () => {
    expect(await readTextIfExists(dir)).toBeNull();
  });
});

describe("readIfExists", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "archgate-fs-read-generic-"));
  });

  afterEach(() => {
    safeRmSync(dir);
  });

  test("passes the BunFile to the reader when it exists", async () => {
    const file = join(dir, "present.bin");
    writeFileSync(file, "abcdef");
    expect(await readIfExists(file, async (f) => f.slice(0, 3).text())).toBe(
      "abc"
    );
  });

  test("supports non-text readers", async () => {
    const file = join(dir, "bytes.bin");
    writeFileSync(file, "AB");
    const bytes = await readIfExists(file, async (f) => f.bytes());
    expect(bytes).toEqual(new Uint8Array([65, 66]));
  });

  test("returns null without invoking the reader when absent", async () => {
    let called = false;
    const result = await readIfExists(join(dir, "absent.bin"), async (f) => {
      called = true;
      return f.text();
    });
    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  test("propagates a reader failure on a file that does exist", async () => {
    // Only absence is absorbed — a present-but-unreadable file still throws,
    // so callers keep their own handling for a corrupt file.
    const file = join(dir, "present.txt");
    writeFileSync(file, "x");
    expect(
      readIfExists(file, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });
});

// An unreadable-but-present file can only be built as a non-root POSIX user:
// chmod is a no-op on Windows, and root bypasses the permission bits entirely
// (CAP_DAC_OVERRIDE), so the read would succeed and the assertion below would
// fail. Root is the default in many containers, though not on CI's runners.
describe.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "readTextIfExists on POSIX as a non-root user",
  () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "archgate-fs-read-posix-"));
    });

    afterEach(() => {
      safeRmSync(dir);
    });

    test("throws when the file exists but cannot be read", async () => {
      const file = join(dir, "locked.txt");
      writeFileSync(file, "secret");
      chmodSync(file, 0o000);
      expect(readTextIfExists(file)).rejects.toThrow();
    });
  }
);
