import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import { getChangedFiles } from "../../src/helpers/git";

describe("getChangedFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-git-test-"));
    await $`git init`.cwd(tempDir).quiet();
    await $`git config user.email "test@test.com"`.cwd(tempDir).quiet();
    await $`git config user.name "Test"`.cwd(tempDir).quiet();
    // Create an initial commit so HEAD exists
    writeFileSync(join(tempDir, "README.md"), "init");
    await $`git add . && git commit -m "init"`.cwd(tempDir).quiet();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns empty array when no changes", async () => {
    const files = await getChangedFiles(tempDir);
    expect(files).toEqual([]);
  });

  test("returns modified files", async () => {
    writeFileSync(join(tempDir, "README.md"), "changed");
    const files = await getChangedFiles(tempDir);
    expect(files).toContain("README.md");
  });

  test("returns staged files", async () => {
    writeFileSync(join(tempDir, "new.ts"), "export const x = 1;");
    await $`git add new.ts`.cwd(tempDir).quiet();
    const files = await getChangedFiles(tempDir);
    expect(files).toContain("new.ts");
  });

  test("deduplicates files that are both staged and modified", async () => {
    writeFileSync(join(tempDir, "file.ts"), "v1");
    await $`git add file.ts`.cwd(tempDir).quiet();
    writeFileSync(join(tempDir, "file.ts"), "v2");
    const files = await getChangedFiles(tempDir);
    const count = files.filter((f) => f === "file.ts").length;
    expect(count).toBe(1);
  });
});
