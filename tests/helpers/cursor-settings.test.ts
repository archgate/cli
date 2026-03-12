import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ARCHGATE_CURSOR_RULE,
  configureCursorSettings,
} from "../../src/helpers/cursor-settings";

describe("ARCHGATE_CURSOR_RULE", () => {
  test("references CLI commands instead of MCP tools", () => {
    expect(ARCHGATE_CURSOR_RULE).toContain("archgate review-context");
    expect(ARCHGATE_CURSOR_RULE).toContain("archgate check --staged");
    expect(ARCHGATE_CURSOR_RULE).toContain("archgate adr list");
    expect(ARCHGATE_CURSOR_RULE).not.toContain("MCP tool");
    expect(ARCHGATE_CURSOR_RULE).not.toContain("MCP");
  });

  test("has alwaysApply frontmatter", () => {
    expect(ARCHGATE_CURSOR_RULE).toContain("alwaysApply: true");
  });
});

describe("configureCursorSettings", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-cursor-settings-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates .cursor/rules/ dir and governance rule file", async () => {
    const rulePath = await configureCursorSettings(tempDir);

    expect(existsSync(join(tempDir, ".cursor"))).toBe(true);
    expect(existsSync(join(tempDir, ".cursor", "rules"))).toBe(true);
    expect(existsSync(rulePath)).toBe(true);
  });

  test("writes the governance rule file with correct content", async () => {
    const rulePath = await configureCursorSettings(tempDir);

    const content = await Bun.file(rulePath).text();
    expect(content).toBe(ARCHGATE_CURSOR_RULE);
  });

  test("does not create mcp.json", async () => {
    await configureCursorSettings(tempDir);

    expect(existsSync(join(tempDir, ".cursor", "mcp.json"))).toBe(false);
  });

  test("returns correct absolute path to rules file", async () => {
    const rulePath = await configureCursorSettings(tempDir);

    expect(rulePath).toBe(
      join(tempDir, ".cursor", "rules", "archgate-governance.mdc")
    );
  });
});
