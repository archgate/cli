import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getGitTrackedFiles,
  getStagedFiles,
  getChangedFiles,
  resolveScopedFiles,
} from "../../src/engine/git-files";

describe("git-files", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-git-files-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("getGitTrackedFiles", () => {
    test("returns null for non-git directory", async () => {
      const result = await getGitTrackedFiles(tempDir);
      expect(result).toBeNull();
    });

    test("returns tracked files in a git repo", async () => {
      await Bun.$`git init`.cwd(tempDir).quiet();
      writeFileSync(join(tempDir, "file.ts"), "export const x = 1;");
      await Bun.$`git add file.ts`.cwd(tempDir).quiet();
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
      await Bun.$`git init`.cwd(tempDir).quiet();
      writeFileSync(join(tempDir, "staged.ts"), "export const x = 1;");
      await Bun.$`git add staged.ts`.cwd(tempDir).quiet();
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
      await Bun.$`git init`.cwd(tempDir).quiet();
      writeFileSync(join(tempDir, "a.ts"), "export const a = 1;");
      await Bun.$`git add a.ts`.cwd(tempDir).quiet();
      await Bun.$`git commit -m "init"`.cwd(tempDir).quiet();
      // Stage a new file (staged change)
      writeFileSync(join(tempDir, "b.ts"), "export const b = 1;");
      await Bun.$`git add b.ts`.cwd(tempDir).quiet();
      // Modify a committed file without staging (unstaged change)
      writeFileSync(join(tempDir, "a.ts"), "export const a = 2;");
      const files = await getChangedFiles(tempDir);
      expect(files).toContain("a.ts");
      expect(files).toContain("b.ts");
    });
  });

  describe("resolveScopedFiles", () => {
    test("returns empty array for non-git directory with no files", async () => {
      const files = await resolveScopedFiles(tempDir, ["**/*.ts"]);
      expect(files).toEqual([]);
    });

    test("resolves files matching glob pattern", async () => {
      await Bun.$`git init`.cwd(tempDir).quiet();
      mkdirSync(join(tempDir, "src"), { recursive: true });
      writeFileSync(join(tempDir, "src", "foo.ts"), "export const x = 1;");
      writeFileSync(join(tempDir, "src", "bar.md"), "# Doc");
      await Bun.$`git add .`.cwd(tempDir).quiet();
      const files = await resolveScopedFiles(tempDir, ["src/**/*.ts"]);
      expect(files).toContain("src/foo.ts");
      expect(files).not.toContain("src/bar.md");
    });
  });
});
