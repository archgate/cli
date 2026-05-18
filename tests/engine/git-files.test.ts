// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getGitTrackedFiles,
  getStagedFiles,
  getChangedFiles,
  resolveScopedFiles,
} from "../../src/engine/git-files";
import { git, safeRmSync } from "../test-utils";

describe("git-files", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-git-files-test-"));
  });

  afterEach(() => {
    safeRmSync(tempDir);
  });

  describe("getGitTrackedFiles", () => {
    test("returns null for non-git directory", async () => {
      const result = await getGitTrackedFiles(tempDir);
      expect(result).toBeNull();
    });

    test("returns tracked files in a git repo", async () => {
      await git(["init"], tempDir);
      writeFileSync(join(tempDir, "file.ts"), "export const x = 1;");
      await git(["add", "file.ts"], tempDir);
      const result = await getGitTrackedFiles(tempDir);
      expect(result).not.toBeNull();
      expect(result!.has("file.ts")).toBe(true);
    });
  });

  describe("getStagedFiles", () => {
    test("returns empty array for non-git directory", async () => {
      const files = await getStagedFiles(tempDir);
      expect(files).toEqual([]);
    });

    test("returns staged files", async () => {
      await git(["init"], tempDir);
      writeFileSync(join(tempDir, "staged.ts"), "export const x = 1;");
      await git(["add", "staged.ts"], tempDir);
      const files = await getStagedFiles(tempDir);
      expect(files).toContain("staged.ts");
    });
  });

  describe("getChangedFiles", () => {
    test("returns empty array for non-git directory", async () => {
      const files = await getChangedFiles(tempDir);
      expect(files).toEqual([]);
    });

    test("returns both staged and unstaged changes", async () => {
      await git(["init"], tempDir);
      await git(["config", "user.email", "test@test.com"], tempDir);
      await git(["config", "user.name", "Test"], tempDir);
      writeFileSync(join(tempDir, "a.ts"), "export const a = 1;");
      await git(["add", "a.ts"], tempDir);
      await git(["commit", "-m", "init"], tempDir);
      // Stage a new file (staged change)
      writeFileSync(join(tempDir, "b.ts"), "export const b = 1;");
      await git(["add", "b.ts"], tempDir);
      // Modify a committed file without staging (unstaged change)
      writeFileSync(join(tempDir, "a.ts"), "export const a = 2;");
      const files = await getChangedFiles(tempDir);
      expect(files).toContain("a.ts");
      expect(files).toContain("b.ts");
    }, 15_000);
  });

  describe("resolveScopedFiles", () => {
    test("returns empty array for non-git directory with no files", async () => {
      const files = await resolveScopedFiles(tempDir, ["**/*.ts"]);
      expect(files).toEqual([]);
    });

    test("resolves files matching glob pattern", async () => {
      await git(["init"], tempDir);
      mkdirSync(join(tempDir, "src"), { recursive: true });
      writeFileSync(join(tempDir, "src", "foo.ts"), "export const x = 1;");
      writeFileSync(join(tempDir, "src", "bar.md"), "# Doc");
      await git(["add", "."], tempDir);
      const files = await resolveScopedFiles(tempDir, ["src/**/*.ts"]);
      expect(files).toContain("src/foo.ts");
      expect(files).not.toContain("src/bar.md");
    });

    test("excludes gitignored files by default", async () => {
      await git(["init"], tempDir);
      await git(["config", "user.email", "test@test.com"], tempDir);
      await git(["config", "user.name", "Test"], tempDir);
      mkdirSync(join(tempDir, "src"), { recursive: true });
      mkdirSync(join(tempDir, "dist"), { recursive: true });
      writeFileSync(join(tempDir, "src", "app.ts"), "export const x = 1;");
      writeFileSync(join(tempDir, "dist", "app.js"), "var x = 1;");
      writeFileSync(join(tempDir, ".gitignore"), "dist/\n");
      await git(["add", "src/app.ts", ".gitignore"], tempDir);
      const files = await resolveScopedFiles(tempDir, ["**/*.ts", "**/*.js"]);
      expect(files).toContain("src/app.ts");
      expect(files).not.toContain("dist/app.js");
    });

    test("includes gitignored files when respectGitignore is false", async () => {
      await git(["init"], tempDir);
      await git(["config", "user.email", "test@test.com"], tempDir);
      await git(["config", "user.name", "Test"], tempDir);
      mkdirSync(join(tempDir, "src"), { recursive: true });
      mkdirSync(join(tempDir, "dist"), { recursive: true });
      writeFileSync(join(tempDir, "src", "app.ts"), "export const x = 1;");
      writeFileSync(join(tempDir, "dist", "app.js"), "var x = 1;");
      writeFileSync(join(tempDir, ".gitignore"), "dist/\n");
      await git(["add", "src/app.ts", ".gitignore"], tempDir);
      const files = await resolveScopedFiles(tempDir, ["**/*.ts", "**/*.js"], {
        respectGitignore: false,
      });
      expect(files).toContain("src/app.ts");
      expect(files).toContain("dist/app.js");
    });

    test("treats empty files array same as omitted (scans all)", async () => {
      await git(["init"], tempDir);
      await git(["config", "user.email", "test@test.com"], tempDir);
      await git(["config", "user.name", "Test"], tempDir);
      mkdirSync(join(tempDir, "src"), { recursive: true });
      writeFileSync(join(tempDir, "src", "app.ts"), "export const x = 1;");
      await git(["add", "src/app.ts"], tempDir);
      const withEmpty = await resolveScopedFiles(tempDir, []);
      const withOmitted = await resolveScopedFiles(tempDir);
      expect(withEmpty).toEqual(withOmitted);
      expect(withEmpty).toContain("src/app.ts");
    });

    // Regression: archgate/cli#222 — ADR `files:` globs must match
    // dot-prefixed source dirs like `.github/`. Bun.Glob with `dot: false`
    // silently drops these on Windows, so ADRs scoped to `.github/**` had
    // empty scopedFiles on Windows local-dev runs.
    test("resolves dot-prefixed paths (regression archgate/cli#222)", async () => {
      await git(["init"], tempDir);
      mkdirSync(join(tempDir, ".github", "workflows"), { recursive: true });
      writeFileSync(
        join(tempDir, ".github", "workflows", "release.yml"),
        "name: release\n"
      );
      writeFileSync(
        join(tempDir, ".github", "workflows", "ci.yml"),
        "name: ci\n"
      );
      await git(["add", "."], tempDir);
      const files = await resolveScopedFiles(tempDir, [
        ".github/workflows/*.yml",
      ]);
      expect(files).toContain(".github/workflows/release.yml");
      expect(files).toContain(".github/workflows/ci.yml");
    });

    test("warns when respectGitignore is false without files scope", async () => {
      await git(["init"], tempDir);
      writeFileSync(join(tempDir, "file.ts"), "export const x = 1;");
      await git(["add", "file.ts"], tempDir);
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      await resolveScopedFiles(tempDir, [], { respectGitignore: false });
      const warnCalls = warnSpy.mock.calls.map((args) => args.join(" "));
      expect(
        warnCalls.some((msg) =>
          msg.includes("respectGitignore is false without a files scope")
        )
      ).toBe(true);
      warnSpy.mockRestore();
    });

    test("warns when file patterns match only gitignored files", async () => {
      await git(["init"], tempDir);
      await git(["config", "user.email", "test@test.com"], tempDir);
      await git(["config", "user.name", "Test"], tempDir);
      mkdirSync(join(tempDir, "dist"), { recursive: true });
      writeFileSync(join(tempDir, "dist", "app.js"), "var x = 1;");
      writeFileSync(join(tempDir, ".gitignore"), "dist/\n");
      await git(["add", ".gitignore"], tempDir);
      await git(["commit", "-m", "init"], tempDir);
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const files = await resolveScopedFiles(tempDir, ["dist/**/*.js"]);
      expect(files).toHaveLength(0);
      const warnCalls = warnSpy.mock.calls.map((args) => args.join(" "));
      expect(
        warnCalls.some((msg) => msg.includes("all are excluded by .gitignore"))
      ).toBe(true);
      warnSpy.mockRestore();
    });

    test("includes adrId in warning when provided", async () => {
      await git(["init"], tempDir);
      writeFileSync(join(tempDir, "file.ts"), "export const x = 1;");
      await git(["add", "file.ts"], tempDir);
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      await resolveScopedFiles(tempDir, [], {
        respectGitignore: false,
        adrId: "BUILD-001",
      });
      const warnCalls = warnSpy.mock.calls.map((args) => args.join(" "));
      expect(warnCalls.some((msg) => msg.includes("ADR BUILD-001"))).toBe(true);
      warnSpy.mockRestore();
    });
  });
});
