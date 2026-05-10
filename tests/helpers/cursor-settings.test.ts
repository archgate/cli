// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
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

  test("returns .cursor/ directory path (no files written)", () => {
    const result = configureCursorSettings(tempDir);
    expect(result).toBe(join(tempDir, ".cursor"));
  });

  test("does not create .cursor/ directory", () => {
    configureCursorSettings(tempDir);
    expect(existsSync(join(tempDir, ".cursor"))).toBe(false);
  });

  test("does not create mcp.json", () => {
    configureCursorSettings(tempDir);
    expect(existsSync(join(tempDir, ".cursor", "mcp.json"))).toBe(false);
  });
});
