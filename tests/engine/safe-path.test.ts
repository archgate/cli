// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
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

/**
 * Whether this platform/account can create a link of the given kind. Probed
 * once: Windows allows directory junctions unprivileged but needs elevation
 * (or Developer Mode) for file symlinks, so the two differ and a single probe
 * would wrongly enable the file-link tests on Windows.
 */
function canLink(kind: "dir" | "file"): boolean {
  const probe = mkdtempSync(join(tmpdir(), "archgate-linkprobe-"));
  try {
    if (kind === "dir") {
      symlinkSync(probe, join(probe, "link"), "junction");
    } else {
      writeFileSync(join(probe, "f.txt"), "x");
      symlinkSync(join(probe, "f.txt"), join(probe, "link.txt"));
    }
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

const DIR_LINKS = canLink("dir");
const FILE_LINKS = canLink("file");

describe("safe-path", () => {
  let tempDir: string;
  let outsideDirs: string[];

  beforeEach(() => {
    tempDir = resolve(mkdtempSync(join(tmpdir(), "archgate-safe-path-")));
    outsideDirs = [];
  });

  // Cleanup runs here, not after each assertion: a failing expect() throws
  // immediately, so a trailing rmSync would be skipped and leak the temp dir.
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    for (const dir of outsideDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A temp directory outside the project root, removed in afterEach. */
  function makeOutsideDir(): string {
    const dir = resolve(mkdtempSync(join(tmpdir(), "archgate-outside-")));
    outsideDirs.push(dir);
    return dir;
  }

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

    test.skipIf(!DIR_LINKS)(
      "throws when an ANCESTOR directory links OUTSIDE the project",
      () => {
        // The leaf is an ordinary file — only the parent is a link, which a
        // leaf-only lstat cannot see.
        const outsideDir = makeOutsideDir();
        writeFileSync(join(outsideDir, "secret.txt"), "sensitive");
        symlinkSync(outsideDir, join(tempDir, "linkdir"), "junction");

        expect(() => safePath(tempDir, "linkdir/secret.txt")).toThrow(
          /resolves outside the project through symbolic link "linkdir" — access denied/u
        );
      }
    );

    test.skipIf(!DIR_LINKS)(
      "ALLOWS an ancestor directory symlink that stays inside the project",
      () => {
        // The workspace-monorepo layout: apps/web/shared -> packages/shared.
        // This escapes nothing, so refusing it would refuse to govern ordinary
        // repositories (pnpm/npm/yarn/bun all symlink workspace packages).
        mkdirSync(join(tempDir, "packages", "shared"), { recursive: true });
        writeFileSync(
          join(tempDir, "packages", "shared", "index.ts"),
          "export {};"
        );
        mkdirSync(join(tempDir, "apps", "web"), { recursive: true });
        symlinkSync(
          join(tempDir, "packages", "shared"),
          join(tempDir, "apps", "web", "shared"),
          "junction"
        );

        expect(() =>
          safePath(tempDir, "apps/web/shared/index.ts")
        ).not.toThrow();
      }
    );

    test.skipIf(!FILE_LINKS)(
      "throws when the LEAF links OUTSIDE the project",
      () => {
        const outsideDir = makeOutsideDir();
        writeFileSync(join(outsideDir, "secret.txt"), "sensitive");
        symlinkSync(join(outsideDir, "secret.txt"), join(tempDir, "link.txt"));

        expect(() => safePath(tempDir, "link.txt")).toThrow(
          /resolves outside the project through symbolic link "link.txt" — access denied/u
        );
      }
    );

    test.skipIf(!FILE_LINKS)(
      "ALLOWS a leaf symlink that stays inside the project",
      () => {
        mkdirSync(join(tempDir, "real"), { recursive: true });
        writeFileSync(join(tempDir, "real", "config.ts"), "export {};");
        symlinkSync(
          join(tempDir, "real", "config.ts"),
          join(tempDir, "config.ts")
        );

        expect(() => safePath(tempDir, "config.ts")).not.toThrow();
      }
    );

    test.skipIf(!DIR_LINKS)(
      "throws when a chain hops inside the project and then out",
      () => {
        // inside-link -> real dir; real dir contains escape -> outside.
        // Allowing the first hop must not stop the walk checking later ones.
        const outsideDir = makeOutsideDir();
        writeFileSync(join(outsideDir, "secret.txt"), "sensitive");
        mkdirSync(join(tempDir, "real"), { recursive: true });
        symlinkSync(join(tempDir, "real"), join(tempDir, "hop"), "junction");
        symlinkSync(outsideDir, join(tempDir, "real", "escape"), "junction");

        expect(() => safePath(tempDir, "hop/escape/secret.txt")).toThrow(
          /resolves outside the project.*access denied/u
        );
      }
    );

    test.skipIf(!DIR_LINKS)(
      "re-resolves a symlink on every call rather than memoizing its verdict",
      () => {
        // A link that passed once must not be trusted afterwards: repointing
        // it must be caught, so the verified-component memo skips symlinks.
        const insideTarget = join(tempDir, "inside");
        mkdirSync(insideTarget, { recursive: true });
        writeFileSync(join(insideTarget, "f.txt"), "ok");
        const outsideDir = makeOutsideDir();
        writeFileSync(join(outsideDir, "f.txt"), "sensitive");

        const link = join(tempDir, "swap");
        symlinkSync(insideTarget, link, "junction");
        expect(() => safePath(tempDir, "swap/f.txt")).not.toThrow();

        // Repoint the same link outside the project.
        rmSync(link, { recursive: true, force: true });
        symlinkSync(outsideDir, link, "junction");
        expect(() => safePath(tempDir, "swap/f.txt")).toThrow(
          /resolves outside the project.*access denied/u
        );
      }
    );

    test.skipIf(!DIR_LINKS)(
      "ALLOWS a dangling link, which resolves to nothing",
      () => {
        // The link's target is gone, so it can reach neither inside nor
        // outside the project; the eventual read fails on its own merits.
        const outsideDir = makeOutsideDir();
        symlinkSync(outsideDir, join(tempDir, "gone"), "junction");
        rmSync(outsideDir, { recursive: true, force: true });

        expect(() => safePath(tempDir, "gone/secret.txt")).not.toThrow();
      }
    );

    test.skipIf(!DIR_LINKS)(
      "stays fail-closed when the root itself cannot be realpath'd",
      () => {
        const outsideDir = makeOutsideDir();
        writeFileSync(join(outsideDir, "secret.txt"), "sensitive");
        symlinkSync(outsideDir, join(tempDir, "linkdir"), "junction");

        const realRealpathSync = fs.realpathSync;
        const realpathSpy = spyOn(fs, "realpathSync");
        // The replacement narrows to the single-argument form the module
        // under test uses; everything else forwards to the real one.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        realpathSpy.mockImplementation(((p: fs.PathLike) => {
          if (p === tempDir) throw new Error("EACCES: permission denied");
          return realRealpathSync(p);
        }) as unknown as typeof fs.realpathSync);

        try {
          // The comparison falls back to the lexical root — an escaping link
          // must still be refused rather than waved through.
          expect(() => safePath(tempDir, "linkdir/secret.txt")).toThrow(
            /resolves outside the project through symbolic link "linkdir"/u
          );
        } finally {
          realpathSpy.mockRestore();
        }
      }
    );
  });
});
