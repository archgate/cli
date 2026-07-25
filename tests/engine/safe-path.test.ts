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

    test("throws when an ANCESTOR directory links OUTSIDE the project", () => {
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
        /resolves outside the project through symbolic link "linkdir" — access denied/u
      );
      rmSync(outsideDir, { recursive: true, force: true });
    });

    test("ALLOWS an ancestor directory symlink that stays inside the project", () => {
      // The workspace-monorepo layout: apps/web/shared -> packages/shared.
      // This escapes nothing, so refusing it would refuse to govern ordinary
      // repositories (pnpm/npm/yarn/bun all symlink workspace packages).
      mkdirSync(join(tempDir, "packages", "shared"), { recursive: true });
      writeFileSync(
        join(tempDir, "packages", "shared", "index.ts"),
        "export {};"
      );
      mkdirSync(join(tempDir, "apps", "web"), { recursive: true });
      try {
        symlinkSync(
          join(tempDir, "packages", "shared"),
          join(tempDir, "apps", "web", "shared"),
          "junction"
        );
      } catch {
        return;
      }
      expect(() => safePath(tempDir, "apps/web/shared/index.ts")).not.toThrow();
    });

    test("throws when the LEAF links OUTSIDE the project", () => {
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
        /resolves outside the project through symbolic link "link.txt" — access denied/u
      );
      rmSync(outsideDir, { recursive: true, force: true });
    });

    test("ALLOWS a leaf symlink that stays inside the project", () => {
      mkdirSync(join(tempDir, "real"), { recursive: true });
      writeFileSync(join(tempDir, "real", "config.ts"), "export {};");
      try {
        symlinkSync(
          join(tempDir, "real", "config.ts"),
          join(tempDir, "config.ts")
        );
      } catch {
        return;
      }
      expect(() => safePath(tempDir, "config.ts")).not.toThrow();
    });

    test("throws when a chain hops inside the project and then out", () => {
      // inside-link -> real dir; real dir contains escape -> outside.
      // Allowing the first hop must not stop the walk checking later ones.
      const outsideDir = mkdtempSync(join(tmpdir(), "archgate-outside-"));
      writeFileSync(join(outsideDir, "secret.txt"), "sensitive");
      mkdirSync(join(tempDir, "real"), { recursive: true });
      try {
        symlinkSync(join(tempDir, "real"), join(tempDir, "hop"), "junction");
        symlinkSync(outsideDir, join(tempDir, "real", "escape"), "junction");
      } catch {
        rmSync(outsideDir, { recursive: true, force: true });
        return;
      }
      expect(() => safePath(tempDir, "hop/escape/secret.txt")).toThrow(
        /resolves outside the project.*access denied/u
      );
      rmSync(outsideDir, { recursive: true, force: true });
    });
  });
});
