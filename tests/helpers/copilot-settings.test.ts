import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ARCHGATE_COPILOT_MCP_CONFIG,
  mergeCopilotMcpConfig,
  configureCopilotSettings,
} from "../../src/helpers/copilot-settings";

describe("mergeCopilotMcpConfig", () => {
  test("sets archgate server when existing config is empty", () => {
    const result = mergeCopilotMcpConfig({}, ARCHGATE_COPILOT_MCP_CONFIG);

    expect(result.mcpServers).toEqual({
      archgate: {
        command: "archgate",
        args: ["mcp"],
      },
    });
  });

  test("preserves existing MCP servers", () => {
    const result = mergeCopilotMcpConfig(
      {
        mcpServers: {
          "other-server": {
            command: "other",
            args: ["start"],
          },
        },
      },
      ARCHGATE_COPILOT_MCP_CONFIG
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
    const result = mergeCopilotMcpConfig(
      {
        mcpServers: {
          archgate: {
            command: "old-command",
            args: ["old"],
          },
        },
      },
      ARCHGATE_COPILOT_MCP_CONFIG
    );

    const servers = result.mcpServers as Record<string, unknown>;
    expect(servers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });

  test("preserves unknown top-level keys", () => {
    const result = mergeCopilotMcpConfig(
      { customKey: "value" },
      ARCHGATE_COPILOT_MCP_CONFIG
    );

    expect(result.customKey).toBe("value");
  });

  test("handles non-object mcpServers gracefully", () => {
    const result = mergeCopilotMcpConfig(
      { mcpServers: "invalid" },
      ARCHGATE_COPILOT_MCP_CONFIG
    );

    expect(result.mcpServers).toEqual({
      archgate: {
        command: "archgate",
        args: ["mcp"],
      },
    });
  });
});

describe("configureCopilotSettings", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-copilot-settings-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates .github/copilot/ dir and mcp.json when nothing exists", async () => {
    const mcpConfigPath = await configureCopilotSettings(tempDir);

    expect(existsSync(join(tempDir, ".github", "copilot"))).toBe(true);
    expect(existsSync(mcpConfigPath)).toBe(true);

    const mcpContent = JSON.parse(await Bun.file(mcpConfigPath).text());
    expect(mcpContent.mcpServers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });

  test("merges into existing mcp.json without overwriting other servers", async () => {
    const copilotDir = join(tempDir, ".github", "copilot");
    mkdirSync(copilotDir, { recursive: true });

    const existingConfig = {
      mcpServers: {
        "my-server": { command: "my-cmd", args: [] },
      },
    };
    await Bun.write(
      join(copilotDir, "mcp.json"),
      JSON.stringify(existingConfig, null, 2)
    );

    await configureCopilotSettings(tempDir);

    const content = JSON.parse(
      await Bun.file(join(copilotDir, "mcp.json")).text()
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
    const mcpConfigPath = await configureCopilotSettings(tempDir);

    expect(mcpConfigPath).toBe(join(tempDir, ".github", "copilot", "mcp.json"));
  });
});
