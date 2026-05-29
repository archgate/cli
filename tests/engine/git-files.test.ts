// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getGitTrackedFiles,
  getStagedFiles,
  getChangedFiles,
  detectBaseRef,
  resolveBaseRef,
  getFilesChangedSinceRef,
  resolveScopedFiles,
  SCOPE_FILE_WARN_THRESHOLD,
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

  describe("detectBaseRef", () => {
    test("returns null for non-git directory", async () => {
      const ref = await detectBaseRef(tempDir);
      expect(ref).toBeNull();
    });

    test("detects local main branch", async () => {
      await git(["init", "--initial-branch=main"], tempDir);
      await git(["config", "user.email", "test@test.com"], tempDir);
      await git(["config", "user.name", "Test"], tempDir);
      writeFileSync(join(tempDir, "file.ts"), "export const x = 1;");
      await git(["add", "file.ts"], tempDir);
      await git(["commit", "-m", "init"], tempDir);
      const ref = await detectBaseRef(tempDir);
      expect(ref).toBe("main");
    });

    test("detects local master branch", async () => {
      await git(["init", "--initial-branch=master"], tempDir);
      await git(["config", "user.email", "test@test.com"], tempDir);
      await git(["config", "user.name", "Test"], tempDir);
      writeFileSync(join(tempDir, "file.ts"), "export const x = 1;");
      await git(["add", "file.ts"], tempDir);
      await git(["commit", "-m", "init"], tempDir);
      const ref = await detectBaseRef(tempDir);
      expect(ref).toBe("master");
    });
  });

  describe("resolveBaseRef", () => {
    test("returns undefined when staged is true", async () => {
      const ref = await resolveBaseRef(tempDir, {
        staged: true,
        base: "main",
        configBase: "origin/main",
      });
      expect(ref).toBeUndefined();
    });

    test("explicit base string wins over configBase", async () => {
      const ref = await resolveBaseRef(tempDir, {
        base: "develop",
        configBase: "origin/main",
      });
      expect(ref).toBe("develop");
    });

    test("configBase wins over auto-detect", async () => {
      // tempDir is not a git repo, so detectBaseRef would return null.
      // configBase should be returned without calling detectBaseRef.
      const ref = await resolveBaseRef(tempDir, { configBase: "origin/main" });
      expect(ref).toBe("origin/main");
    });

    test("falls back to undefined when no config and not a git repo", async () => {
      const ref = await resolveBaseRef(tempDir, {});
      expect(ref).toBeUndefined();
    });

    test("falls back to detectBaseRef and returns detected branch", async () => {
      await git(["init", "--initial-branch=main"], tempDir);
      await git(["config", "user.email", "test@test.com"], tempDir);
      await git(["config", "user.name", "Test"], tempDir);
      writeFileSync(join(tempDir, "file.ts"), "export const x = 1;");
      await git(["add", "file.ts"], tempDir);
      await git(["commit", "-m", "init"], tempDir);

      const ref = await resolveBaseRef(tempDir, {});
      expect(ref).toBe("main");
    }, 15_000);

    test("lazy-saves detected base branch to config.json", async () => {
      await git(["init", "--initial-branch=main"], tempDir);
      await git(["config", "user.email", "test@test.com"], tempDir);
      await git(["config", "user.name", "Test"], tempDir);
      writeFileSync(join(tempDir, "file.ts"), "export const x = 1;");
      await git(["add", "file.ts"], tempDir);
      await git(["commit", "-m", "init"], tempDir);

      // No configBase — triggers detectBaseRef + lazy-save
      await resolveBaseRef(tempDir, {});

      const configPath = join(tempDir, ".archgate", "config.json");
      expect(existsSync(configPath)).toBe(true);
      const config = JSON.parse(await Bun.file(configPath).text());
      expect(config.baseBranch).toBe("main");
    }, 15_000);

    test("does not overwrite existing baseBranch on lazy-save", async () => {
      await git(["init", "--initial-branch=main"], tempDir);
      await git(["config", "user.email", "test@test.com"], tempDir);
      await git(["config", "user.name", "Test"], tempDir);
      writeFileSync(join(tempDir, "file.ts"), "export const x = 1;");
      await git(["add", "file.ts"], tempDir);
      await git(["commit", "-m", "init"], tempDir);

      // Pre-create config with a custom baseBranch
      mkdirSync(join(tempDir, ".archgate"), { recursive: true });
      await Bun.write(
        join(tempDir, ".archgate", "config.json"),
        JSON.stringify({ baseBranch: "develop" }, null, 2) + "\n"
      );

      // configBase is null (simulating caller didn't find it) but config has baseBranch
      await resolveBaseRef(tempDir, {});

      const config = JSON.parse(
        await Bun.file(join(tempDir, ".archgate", "config.json")).text()
      );
      expect(config.baseBranch).toBe("develop");
    }, 15_000);
  });

  describe("getFilesChangedSinceRef", () => {
    test("returns empty array for non-git directory", async () => {
      const files = await getFilesChangedSinceRef(tempDir, "main");
      expect(files).toEqual([]);
    });

    test("returns files changed on a feature branch", async () => {
      await git(["init", "--initial-branch=main"], tempDir);
      await git(["config", "user.email", "test@test.com"], tempDir);
      await git(["config", "user.name", "Test"], tempDir);
      writeFileSync(join(tempDir, "base.ts"), "export const x = 1;");
      await git(["add", "base.ts"], tempDir);
      await git(["commit", "-m", "init"], tempDir);
      // Create feature branch and add files
      await git(["checkout", "-b", "feature"], tempDir);
      writeFileSync(join(tempDir, "new-file.ts"), "export const y = 2;");
      await git(["add", "new-file.ts"], tempDir);
      await git(["commit", "-m", "add new file"], tempDir);
      const files = await getFilesChangedSinceRef(tempDir, "main");
      expect(files).toContain("new-file.ts");
      expect(files).not.toContain("base.ts");
    }, 15_000);

    test("returns empty when on the base branch with no new commits", async () => {
      await git(["init", "--initial-branch=main"], tempDir);
      await git(["config", "user.email", "test@test.com"], tempDir);
      await git(["config", "user.name", "Test"], tempDir);
      writeFileSync(join(tempDir, "base.ts"), "export const x = 1;");
      await git(["add", "base.ts"], tempDir);
      await git(["commit", "-m", "init"], tempDir);
      const files = await getFilesChangedSinceRef(tempDir, "main");
      expect(files).toEqual([]);
    });

    test("returns multiple changed files sorted", async () => {
      await git(["init", "--initial-branch=main"], tempDir);
      await git(["config", "user.email", "test@test.com"], tempDir);
      await git(["config", "user.name", "Test"], tempDir);
      writeFileSync(join(tempDir, "base.ts"), "export const x = 1;");
      await git(["add", "base.ts"], tempDir);
      await git(["commit", "-m", "init"], tempDir);
      await git(["checkout", "-b", "feature"], tempDir);
      writeFileSync(join(tempDir, "z-file.ts"), "export const z = 3;");
      writeFileSync(join(tempDir, "a-file.ts"), "export const a = 1;");
      await git(["add", "."], tempDir);
      await git(["commit", "-m", "add files"], tempDir);
      const files = await getFilesChangedSinceRef(tempDir, "main");
      expect(files).toEqual(["a-file.ts", "z-file.ts"]);
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

    test("warns when file scope exceeds threshold", async () => {
      await git(["init"], tempDir);
      mkdirSync(join(tempDir, "src"), { recursive: true });
      // Use a tiny injected threshold so we only need a handful of files —
      // creating 1000+ real files + `git add .` is slow enough on Windows
      // runners to trip the per-test timeout (SIGTERM mid-`git add`).
      const fileWarnThreshold = 5;
      const fileCount = fileWarnThreshold + 1;
      for (let i = 0; i < fileCount; i++) {
        writeFileSync(
          join(tempDir, "src", `file-${String(i).padStart(4, "0")}.ts`),
          `export const x${i} = ${i};`
        );
      }
      await git(["add", "."], tempDir);
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const files = await resolveScopedFiles(tempDir, ["src/**/*.ts"], {
          adrId: "SCOPE-001",
          fileWarnThreshold,
        });
        expect(files.length).toBeGreaterThan(fileWarnThreshold);
        const warnCalls = warnSpy.mock.calls.map((args) => args.join(" "));
        expect(
          warnCalls.some(
            (msg) =>
              msg.includes("ADR SCOPE-001") &&
              msg.includes(`${fileCount} files`) &&
              msg.includes("scan took") &&
              msg.includes("Consider narrowing")
          )
        ).toBe(true);
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("does not warn when file scope is within threshold", async () => {
      await git(["init"], tempDir);
      mkdirSync(join(tempDir, "src"), { recursive: true });
      for (let i = 0; i < 10; i++) {
        writeFileSync(
          join(tempDir, "src", `file-${i}.ts`),
          `export const x${i} = ${i};`
        );
      }
      await git(["add", "."], tempDir);
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const files = await resolveScopedFiles(tempDir, ["src/**/*.ts"]);
        expect(files.length).toBeLessThanOrEqual(SCOPE_FILE_WARN_THRESHOLD);
        const warnCalls = warnSpy.mock.calls.map((args) => args.join(" "));
        expect(
          warnCalls.some((msg) => msg.includes("Consider narrowing"))
        ).toBe(false);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
