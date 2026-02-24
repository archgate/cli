import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ARCHGATE_CURSOR_MCP_CONFIG,
  ARCHGATE_CURSOR_RULE,
  mergeCursorMcpConfig,
  configureCursorSettings,
} from "../../src/helpers/cursor-settings";

describe("mergeCursorMcpConfig", () => {
  test("sets archgate server when existing config is empty", () => {
    const result = mergeCursorMcpConfig({}, ARCHGATE_CURSOR_MCP_CONFIG);

    expect(result.mcpServers).toEqual({
      archgate: {
        command: "archgate",
        args: ["mcp"],
      },
    });
  });

  test("preserves existing MCP servers", () => {
    const result = mergeCursorMcpConfig(
      {
        mcpServers: {
          "other-server": {
            command: "other",
            args: ["start"],
          },
        },
      },
      ARCHGATE_CURSOR_MCP_CONFIG
    );

    const servers = result.mcpServers as Record<string, unknown>;
    expect(servers["other-server"]).toEqual({
      command: "other",
      args: ["start"],
    });
    expect(servers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });

  test("overwrites existing archgate server entry", () => {
    const result = mergeCursorMcpConfig(
      {
        mcpServers: {
          archgate: {
            command: "old-command",
            args: ["old"],
          },
        },
      },
      ARCHGATE_CURSOR_MCP_CONFIG
    );

    const servers = result.mcpServers as Record<string, unknown>;
    expect(servers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });

  test("preserves unknown top-level keys", () => {
    const result = mergeCursorMcpConfig(
      { customKey: "value" },
      ARCHGATE_CURSOR_MCP_CONFIG
    );

    expect(result.customKey).toBe("value");
  });

  test("handles non-object mcpServers gracefully", () => {
    const result = mergeCursorMcpConfig(
      { mcpServers: "invalid" },
      ARCHGATE_CURSOR_MCP_CONFIG
    );

    expect(result.mcpServers).toEqual({
      archgate: {
        command: "archgate",
        args: ["mcp"],
      },
    });
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

  test("creates .cursor/ dir, mcp.json, and rules file when nothing exists", async () => {
    const mcpConfigPath = await configureCursorSettings(tempDir);

    expect(existsSync(join(tempDir, ".cursor"))).toBe(true);
    expect(existsSync(mcpConfigPath)).toBe(true);
    expect(
      existsSync(join(tempDir, ".cursor", "rules", "archgate-governance.mdc"))
    ).toBe(true);

    const mcpContent = JSON.parse(await Bun.file(mcpConfigPath).text());
    expect(mcpContent.mcpServers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });

  test("writes the governance rule file with alwaysApply", async () => {
    await configureCursorSettings(tempDir);

    const rulePath = join(
      tempDir,
      ".cursor",
      "rules",
      "archgate-governance.mdc"
    );
    const content = await Bun.file(rulePath).text();
    expect(content).toContain("alwaysApply: true");
    expect(content).toContain("review_context");
    expect(content).toContain("check");
    expect(content).toBe(ARCHGATE_CURSOR_RULE);
  });

  test("merges into existing mcp.json without overwriting other servers", async () => {
    const cursorDir = join(tempDir, ".cursor");
    mkdirSync(cursorDir, { recursive: true });

    const existingConfig = {
      mcpServers: {
        "my-server": { command: "my-cmd", args: [] },
      },
    };
    await Bun.write(
      join(cursorDir, "mcp.json"),
      JSON.stringify(existingConfig, null, 2)
    );

    await configureCursorSettings(tempDir);

    const content = JSON.parse(
      await Bun.file(join(cursorDir, "mcp.json")).text()
    );
    expect(content.mcpServers["my-server"]).toEqual({
      command: "my-cmd",
      args: [],
    });
    expect(content.mcpServers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });

  test("returns correct absolute path to mcp.json", async () => {
    const mcpConfigPath = await configureCursorSettings(tempDir);

    expect(mcpConfigPath).toBe(join(tempDir, ".cursor", "mcp.json"));
  });
});
