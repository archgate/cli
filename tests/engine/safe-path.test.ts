// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  isWithinRoot,
  resolveUserPath,
  safePath,
} from "../../src/engine/safe-path";

describe("safe-path", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = resolve(mkdtempSync(join(tmpdir(), "archgate-safe-path-")));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("resolveUserPath", () => {
    test("resolves a relative path against the root", () => {
      expect(resolveUserPath(tempDir, "src/app.ts")).toBe(
        resolve(tempDir, "src", "app.ts")
      );
    });

    test("keeps an absolute path as-is (resolved)", () => {
      const abs = join(tempDir, "config.yml");
      expect(resolveUserPath(tempDir, abs)).toBe(resolve(abs));
    });
  });

  describe("isWithinRoot", () => {
    test("accepts the root itself and paths under it", () => {
      expect(isWithinRoot(tempDir, tempDir)).toBe(true);
      expect(isWithinRoot(tempDir, join(tempDir, "a", "b"))).toBe(true);
    });

    test("rejects siblings and parents", () => {
      expect(isWithinRoot(tempDir, resolve(tempDir, ".."))).toBe(false);
      expect(isWithinRoot(tempDir, `${tempDir}-sibling`)).toBe(false);
    });
  });

  describe("safePath", () => {
    test("returns the absolute path for an in-root file", () => {
      writeFileSync(join(tempDir, "ok.txt"), "x");
      expect(safePath(tempDir, "ok.txt")).toBe(join(tempDir, "ok.txt"));
    });

    test("accepts a deep chain of real directories", () => {
      mkdirSync(join(tempDir, "a", "b", "c"), { recursive: true });
      writeFileSync(join(tempDir, "a", "b", "c", "deep.txt"), "x");
      expect(() => safePath(tempDir, "a/b/c/deep.txt")).not.toThrow();
    });

    test("does not throw for a non-existent in-root path", () => {
      expect(() => safePath(tempDir, "missing/file.txt")).not.toThrow();
    });

    test("accepts the root itself", () => {
      expect(safePath(tempDir, ".")).toBe(tempDir);
    });

    test("throws on traversal outside the root", () => {
      expect(() => safePath(tempDir, "../outside.txt")).toThrow(
        /escapes project root/u
      );
    });

    test("throws when an ANCESTOR directory is a symlink", () => {
      // The leaf is an ordinary file — only the parent is a link, which a
      // leaf-only lstat cannot see.
      const outsideDir = mkdtempSync(join(tmpdir(), "archgate-outside-"));
      writeFileSync(join(outsideDir, "secret.txt"), "sensitive");
      try {
        // "junction" is ignored on POSIX; on Windows it needs no admin rights
        // and lstat reports it as a symlink, so this runs on every platform.
        symlinkSync(outsideDir, join(tempDir, "linkdir"), "junction");
      } catch {
        rmSync(outsideDir, { recursive: true, force: true });
        return;
      }
      expect(() => safePath(tempDir, "linkdir/secret.txt")).toThrow(
        /traverses symbolic link "linkdir" — access denied/u
      );
      rmSync(outsideDir, { recursive: true, force: true });
    });

    test("throws when the LEAF itself is a symlink", () => {
      const outsideDir = mkdtempSync(join(tmpdir(), "archgate-outside-"));
      writeFileSync(join(outsideDir, "secret.txt"), "sensitive");
      try {
        symlinkSync(join(outsideDir, "secret.txt"), join(tempDir, "link.txt"));
      } catch {
        // File symlinks still need admin/developer mode on Windows — skip.
        rmSync(outsideDir, { recursive: true, force: true });
        return;
      }
      expect(() => safePath(tempDir, "link.txt")).toThrow(
        /is a symbolic link — access denied/u
      );
      rmSync(outsideDir, { recursive: true, force: true });
    });
  });
});
