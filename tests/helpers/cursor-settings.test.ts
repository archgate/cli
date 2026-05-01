import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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

  test("returns .cursor/ directory path (no files written)", async () => {
    const result = await configureCursorSettings(tempDir);
    expect(result).toBe(join(tempDir, ".cursor"));
  });

  test("does not create .cursor/ directory", async () => {
    const { existsSync } = await import("node:fs");
    await configureCursorSettings(tempDir);
    expect(existsSync(join(tempDir, ".cursor"))).toBe(false);
  });

  test("does not create mcp.json", async () => {
    const { existsSync } = await import("node:fs");
    await configureCursorSettings(tempDir);
    expect(existsSync(join(tempDir, ".cursor", "mcp.json"))).toBe(false);
  });
});
