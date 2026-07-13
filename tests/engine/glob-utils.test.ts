// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getGitTrackedFiles } from "../../src/engine/git-files";
import {
  listMatchingFiles,
  matchTrackedFiles,
} from "../../src/engine/glob-utils";
import { git, safeRmSync } from "../test-utils";

describe("matchTrackedFiles", () => {
  test("matches patterns against the tracked set without touching the filesystem", () => {
    const tracked = new Set([
      "src/cli.ts",
      "src/engine/runner.ts",
      "README.md",
    ]);
    const matched = matchTrackedFiles(["src/**/*.ts"], tracked);
    expect(matched).toEqual(new Set(["src/cli.ts", "src/engine/runner.ts"]));
  });

  test("matches dot-prefixed paths without any dot option (ARCH-020 parity)", () => {
    const tracked = new Set([
      ".github/workflows/ci.yml",
      ".husky/pre-commit",
      "src/cli.ts",
    ]);
    const matched = matchTrackedFiles(["**/*.yml"], tracked);
    expect(matched).toEqual(new Set([".github/workflows/ci.yml"]));
  });

  test("handles brace groups with path separators natively (oven-sh/bun#32596)", () => {
    const tracked = new Set(["svc/src/env.ts", "svc/env.ts", "svc/other.ts"]);
    const matched = matchTrackedFiles(["svc/{src/env.ts,env.ts}"], tracked);
    expect(matched).toEqual(new Set(["svc/src/env.ts", "svc/env.ts"]));
  });

  test("unions matches across multiple patterns", () => {
    const tracked = new Set(["a.ts", "b.md", "c.json"]);
    const matched = matchTrackedFiles(["*.ts", "*.md"], tracked);
    expect(matched).toEqual(new Set(["a.ts", "b.md"]));
  });
});

describe("listMatchingFiles", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-glob-utils-test-"));
  });

  afterEach(() => {
    safeRmSync(tempDir);
  });

  test("fast path: matches against tracked files in memory, sorted", async () => {
    const tracked = new Set(["src/z.ts", "src/a.ts", "docs/readme.md"]);
    const files = await listMatchingFiles(tempDir, "src/**/*.ts", tracked);
    expect(files).toEqual(["src/a.ts", "src/z.ts"]);
  });

  test("fallback path: walks the filesystem when trackedFiles is null", async () => {
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(join(tempDir, "src", "a.ts"), "export const a = 1;");
    writeFileSync(join(tempDir, "src", "b.md"), "# doc");
    const files = await listMatchingFiles(tempDir, "src/**/*.ts", null);
    expect(files).toEqual(["src/a.ts"]);
  });

  // The sandbox contract must hold on the in-memory fast path exactly as it
  // does on the filesystem fallback: brace expansion can surface absolute or
  // `..` alternatives hidden inside a brace group.
  test("fast path rejects absolute paths hidden in brace alternatives", async () => {
    const tracked = new Set(["src/a.ts"]);
    await expect(
      listMatchingFiles(tempDir, "{/etc/passwd,src/a.ts}", tracked)
    ).rejects.toThrow("access denied");
  });

  test("fast path rejects .. traversal hidden in brace alternatives", async () => {
    const tracked = new Set(["src/a.ts"]);
    await expect(
      listMatchingFiles(tempDir, "{../escape,src/a.ts}", tracked)
    ).rejects.toThrow("access denied");
  });

  test("fallback path rejects absolute paths hidden in brace alternatives", async () => {
    await expect(
      listMatchingFiles(tempDir, "{/etc/passwd,src/a.ts}", null)
    ).rejects.toThrow("access denied");
  });

  // The tracked set that in-memory matching consumes must only contain files
  // that exist on disk — `git ls-files --cached` also lists files deleted
  // from the worktree but not yet staged, which a filesystem walk would
  // never return. getGitTrackedFiles subtracts `ls-files --deleted`.
  test("tracked set excludes files deleted from the worktree", async () => {
    await git(["init"], tempDir);
    writeFileSync(join(tempDir, "kept.ts"), "export const k = 1;");
    writeFileSync(join(tempDir, "gone.ts"), "export const g = 1;");
    await git(["add", "."], tempDir);
    safeRmSync(join(tempDir, "gone.ts")); // deleted, deletion NOT staged
    const tracked = await getGitTrackedFiles(tempDir);
    expect(tracked!.has("kept.ts")).toBe(true);
    expect(tracked!.has("gone.ts")).toBe(false);
    const files = await listMatchingFiles(tempDir, "**/*.ts", tracked);
    expect(files).toEqual(["kept.ts"]);
  }, 15_000);
});
