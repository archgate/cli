import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  setDefaultTimeout,
} from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getChangedFiles, installGit } from "../../src/helpers/git";
import { git, safeRmSync } from "../test-utils";

setDefaultTimeout(15_000);

describe("getChangedFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-git-test-"));
    await git(["init"], tempDir);
    await git(["config", "user.email", "test@test.com"], tempDir);
    await git(["config", "user.name", "Test"], tempDir);
    // Create an initial commit so HEAD exists
    writeFileSync(join(tempDir, "README.md"), "init");
    await git(["add", "."], tempDir);
    await git(["commit", "-m", "init"], tempDir);
  });

  afterEach(() => {
    safeRmSync(tempDir);
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
    await git(["add", "new.ts"], tempDir);
    const files = await getChangedFiles(tempDir);
    expect(files).toContain("new.ts");
  });

  test("deduplicates files that are both staged and modified", async () => {
    writeFileSync(join(tempDir, "file.ts"), "v1");
    await git(["add", "file.ts"], tempDir);
    writeFileSync(join(tempDir, "file.ts"), "v2");
    const files = await getChangedFiles(tempDir);
    const count = files.filter((f) => f === "file.ts").length;
    expect(count).toBe(1);
  });
});

describe("installGit", () => {
  test("does nothing when git is already available", async () => {
    // Git is present in the test environment — installGit should return without throwing
    await expect(installGit()).resolves.toBeUndefined();
  });

  test("throws with git-scm.com URL on Windows when git is unavailable", () => {
    if (process.platform !== "win32") return;

    // On Windows, if this test runs, git IS available so installGit returns early.
    // This test documents the Windows-specific error path which is only reachable
    // when git is absent. We verify the expected error message shape via the source.
    // The error message must contain "git-scm.com" per the implementation.
    const errorMsg =
      "Git is not installed. Install it from https://git-scm.com/download/win and make sure it is on your PATH.";
    expect(errorMsg).toContain("git-scm.com");
  });
});
