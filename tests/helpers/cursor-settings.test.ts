// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configureCursorSettings } from "../../src/helpers/cursor-settings";

describe("configureCursorSettings", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-cursor-settings-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns .cursor/ directory path", () => {
    const result = configureCursorSettings(tempDir);
    expect(result).toBe(join(tempDir, ".cursor"));
  });

  test("creates .cursor/rules/ directory and governance rule", () => {
    configureCursorSettings(tempDir);
    expect(existsSync(join(tempDir, ".cursor", "rules"))).toBe(true);
    const rulePath = join(
      tempDir,
      ".cursor",
      "rules",
      "archgate-governance.mdc"
    );
    expect(existsSync(rulePath)).toBe(true);
    const content = readFileSync(rulePath, "utf-8");
    expect(content).toContain("alwaysApply: true");
    expect(content).toContain("archgate check");
  });

  test("creates .cursor/hooks.json", () => {
    configureCursorSettings(tempDir);
    const hooksPath = join(tempDir, ".cursor", "hooks.json");
    expect(existsSync(hooksPath)).toBe(true);
    const hooks = JSON.parse(readFileSync(hooksPath, "utf-8"));
    expect(hooks).toBeArrayOfSize(1);
    expect(hooks[0].event).toBe("afterFileEdit");
    expect(hooks[0].command).toContain("archgate check");
  });

  test("does not overwrite existing governance rule", async () => {
    configureCursorSettings(tempDir);
    // Write a custom rule
    const rulePath = join(
      tempDir,
      ".cursor",
      "rules",
      "archgate-governance.mdc"
    );
    await Bun.write(rulePath, "custom rule");
    // Re-run — should not overwrite
    configureCursorSettings(tempDir);
    expect(readFileSync(rulePath, "utf-8")).toBe("custom rule");
  });
});
