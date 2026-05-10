// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findProjectRoot } from "../../src/helpers/paths";

describe("findProjectRoot", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-paths-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("finds root when .archgate/adrs/ exists", () => {
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });

    const result = findProjectRoot(tempDir);
    expect(result).toBe(tempDir);
  });

  test("finds root when .archgate/lint/ exists (custom ADR paths)", () => {
    // A project with custom ADR paths may not have .archgate/adrs/,
    // but .archgate/lint/ is always created by `archgate init`.
    mkdirSync(join(tempDir, ".archgate", "lint"), { recursive: true });

    const result = findProjectRoot(tempDir);
    expect(result).toBe(tempDir);
  });

  test("finds root from a subdirectory", () => {
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    const subDir = join(tempDir, "src", "commands");
    mkdirSync(subDir, { recursive: true });

    const result = findProjectRoot(subDir);
    expect(result).toBe(tempDir);
  });

  test("does not match directory without .archgate/adrs/ or .archgate/lint/", () => {
    // A directory with only a bare .archgate/ (like ~/.archgate/ user cache)
    // should NOT be detected as a project root.
    const parent = join(tempDir, "parent");
    const child = join(parent, "child");
    mkdirSync(child, { recursive: true });
    // Create bare .archgate/ with no adrs/ or lint/
    mkdirSync(join(parent, ".archgate"), { recursive: true });

    const result = findProjectRoot(child);
    // Should walk past parent (bare .archgate/) without matching it
    expect(result).not.toBe(parent);
  });
});
