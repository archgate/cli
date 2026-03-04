import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  mergeVscodeSettings,
  configureVscodeSettings,
} from "../../src/helpers/vscode-settings";

const MARKETPLACE_URL = "https://user:token@plugins.archgate.dev/archgate.git";

describe("mergeVscodeSettings", () => {
  test("sets marketplace URL and MCP server when existing settings are empty", () => {
    const result = mergeVscodeSettings({}, MARKETPLACE_URL);

    expect(result["chat.plugins.marketplaces"]).toEqual([MARKETPLACE_URL]);
    const mcp = result.mcp as Record<string, unknown>;
    const servers = mcp.servers as Record<string, unknown>;
    expect(servers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });

  test("appends marketplace URL with dedup", () => {
    const result = mergeVscodeSettings(
      { "chat.plugins.marketplaces": ["https://other.git", MARKETPLACE_URL] },
      MARKETPLACE_URL
    );

    expect(result["chat.plugins.marketplaces"]).toEqual([
      "https://other.git",
      MARKETPLACE_URL,
    ]);
  });

  test("preserves existing MCP servers", () => {
    const result = mergeVscodeSettings(
      {
        mcp: {
          servers: {
            "other-server": { command: "other", args: ["start"] },
          },
        },
      },
      MARKETPLACE_URL
    );

    const mcp = result.mcp as Record<string, unknown>;
    const servers = mcp.servers as Record<string, unknown>;
    expect(servers["other-server"]).toEqual({
      command: "other",
      args: ["start"],
    });
    expect(servers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });

  test("preserves unknown top-level keys", () => {
    const result = mergeVscodeSettings(
      { "editor.fontSize": 14, "workbench.colorTheme": "One Dark" },
      MARKETPLACE_URL
    );

    expect(result["editor.fontSize"]).toBe(14);
    expect(result["workbench.colorTheme"]).toBe("One Dark");
  });

  test("handles non-array marketplaces gracefully", () => {
    const result = mergeVscodeSettings(
      { "chat.plugins.marketplaces": "not-an-array" },
      MARKETPLACE_URL
    );

    expect(result["chat.plugins.marketplaces"]).toEqual([MARKETPLACE_URL]);
  });

  test("handles non-object mcp gracefully", () => {
    const result = mergeVscodeSettings({ mcp: "invalid" }, MARKETPLACE_URL);

    const mcp = result.mcp as Record<string, unknown>;
    const servers = mcp.servers as Record<string, unknown>;
    expect(servers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });

  test("handles non-object mcp.servers gracefully", () => {
    const result = mergeVscodeSettings(
      { mcp: { servers: "invalid" } },
      MARKETPLACE_URL
    );

    const mcp = result.mcp as Record<string, unknown>;
    const servers = mcp.servers as Record<string, unknown>;
    expect(servers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });
});

describe("configureVscodeSettings", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-vscode-settings-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates .vscode/ dir and settings.json when neither exists", async () => {
    const settingsPath = await configureVscodeSettings(
      tempDir,
      MARKETPLACE_URL
    );

    expect(existsSync(join(tempDir, ".vscode"))).toBe(true);
    expect(existsSync(settingsPath)).toBe(true);

    const content = JSON.parse(await Bun.file(settingsPath).text());
    expect(content["chat.plugins.marketplaces"]).toEqual([MARKETPLACE_URL]);
    const servers = content.mcp.servers;
    expect(servers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });

  test("merges into existing settings.json without overwriting user entries", async () => {
    const vscodeDir = join(tempDir, ".vscode");
    mkdirSync(vscodeDir, { recursive: true });

    const existingSettings = {
      "editor.fontSize": 14,
      "chat.plugins.marketplaces": ["https://other.git"],
      mcp: {
        servers: {
          "my-server": { command: "my-cmd", args: [] },
        },
      },
    };
    await Bun.write(
      join(vscodeDir, "settings.json"),
      JSON.stringify(existingSettings, null, 2)
    );

    await configureVscodeSettings(tempDir, MARKETPLACE_URL);

    const content = JSON.parse(
      await Bun.file(join(vscodeDir, "settings.json")).text()
    );
    expect(content["editor.fontSize"]).toBe(14);
    expect(content["chat.plugins.marketplaces"]).toContain("https://other.git");
    expect(content["chat.plugins.marketplaces"]).toContain(MARKETPLACE_URL);
    expect(content.mcp.servers["my-server"]).toEqual({
      command: "my-cmd",
      args: [],
    });
    expect(content.mcp.servers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });

  test("returns correct absolute path", async () => {
    const settingsPath = await configureVscodeSettings(
      tempDir,
      MARKETPLACE_URL
    );

    expect(settingsPath).toBe(join(tempDir, ".vscode", "settings.json"));
  });
});
