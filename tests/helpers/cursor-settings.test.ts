// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configureCursorSettings } from "../../src/helpers/cursor-settings";

describe("configureCursorSettings", () => {
  let tempDir: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-cursor-settings-test-"));
    savedHome = Bun.env.HOME;
    Bun.env.HOME = tempDir;
  });

  afterEach(() => {
    Bun.env.HOME = savedHome;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns user-scope ~/.cursor/plugins/local/ path", () => {
    const result = configureCursorSettings();
    expect(result).toBe(join(tempDir, ".cursor", "plugins", "local"));
  });

  test("does not create directories", () => {
    configureCursorSettings();
    expect(existsSync(join(tempDir, ".cursor"))).toBe(false);
  });
});
