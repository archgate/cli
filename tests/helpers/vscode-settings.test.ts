import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ARCHGATE_VSCODE_MCP_CONFIG,
  mergeVscodeMcpConfig,
  mergeMarketplaceUrl,
  configureVscodeSettings,
  addMarketplaceToUserSettings,
} from "../../src/helpers/vscode-settings";

describe("mergeVscodeMcpConfig", () => {
  test("sets archgate server when existing config is empty", () => {
    const result = mergeVscodeMcpConfig({}, ARCHGATE_VSCODE_MCP_CONFIG);

    expect(result.servers).toEqual({
      archgate: {
        command: "archgate",
        args: ["mcp"],
      },
    });
  });

  test("preserves existing MCP servers", () => {
    const result = mergeVscodeMcpConfig(
      {
        servers: {
          "other-server": {
            command: "other",
            args: ["start"],
          },
        },
      },
      ARCHGATE_VSCODE_MCP_CONFIG
    );

    const servers = result.servers as Record<string, unknown>;
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
    const result = mergeVscodeMcpConfig(
      {
        servers: {
          archgate: {
            command: "old-command",
            args: ["old"],
          },
        },
      },
      ARCHGATE_VSCODE_MCP_CONFIG
    );

    const servers = result.servers as Record<string, unknown>;
    expect(servers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });

  test("preserves unknown top-level keys", () => {
    const result = mergeVscodeMcpConfig(
      { inputs: [{ type: "promptString", id: "key" }] },
      ARCHGATE_VSCODE_MCP_CONFIG
    );

    expect(result.inputs).toEqual([{ type: "promptString", id: "key" }]);
  });

  test("handles non-object servers gracefully", () => {
    const result = mergeVscodeMcpConfig(
      { servers: "invalid" },
      ARCHGATE_VSCODE_MCP_CONFIG
    );

    expect(result.servers).toEqual({
      archgate: {
        command: "archgate",
        args: ["mcp"],
      },
    });
  });
});

describe("mergeMarketplaceUrl", () => {
  const URL = "https://user:token@plugins.archgate.dev/archgate.git";

  test("adds marketplace URL to empty settings", () => {
    const result = mergeMarketplaceUrl({}, URL);
    expect(result["chat.plugins.marketplaces"]).toEqual([URL]);
  });

  test("appends URL with dedup", () => {
    const result = mergeMarketplaceUrl(
      { "chat.plugins.marketplaces": ["https://other.git", URL] },
      URL
    );
    expect(result["chat.plugins.marketplaces"]).toEqual([
      "https://other.git",
      URL,
    ]);
  });

  test("handles non-array marketplaces gracefully", () => {
    const result = mergeMarketplaceUrl(
      { "chat.plugins.marketplaces": "not-an-array" },
      URL
    );
    expect(result["chat.plugins.marketplaces"]).toEqual([URL]);
  });

  test("preserves other settings keys", () => {
    const result = mergeMarketplaceUrl(
      { "editor.fontSize": 14, "workbench.colorTheme": "One Dark" },
      URL
    );
    expect(result["editor.fontSize"]).toBe(14);
    expect(result["workbench.colorTheme"]).toBe("One Dark");
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

  test("creates .vscode/ dir and mcp.json when nothing exists", async () => {
    const mcpConfigPath = await configureVscodeSettings(tempDir);

    expect(existsSync(join(tempDir, ".vscode"))).toBe(true);
    expect(existsSync(mcpConfigPath)).toBe(true);

    const content = JSON.parse(await Bun.file(mcpConfigPath).text());
    expect(content.servers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });

  test("merges into existing mcp.json without overwriting other servers", async () => {
    const vscodeDir = join(tempDir, ".vscode");
    mkdirSync(vscodeDir, { recursive: true });

    const existingConfig = {
      servers: {
        "my-server": { command: "my-cmd", args: [] },
      },
    };
    await Bun.write(
      join(vscodeDir, "mcp.json"),
      JSON.stringify(existingConfig, null, 2)
    );

    await configureVscodeSettings(tempDir);

    const content = JSON.parse(
      await Bun.file(join(vscodeDir, "mcp.json")).text()
    );
    expect(content.servers["my-server"]).toEqual({
      command: "my-cmd",
      args: [],
    });
    expect(content.servers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });

  test("parses JSONC (comments + trailing commas) in existing mcp.json", async () => {
    const vscodeDir = join(tempDir, ".vscode");
    mkdirSync(vscodeDir, { recursive: true });

    // Write JSONC with comments and trailing comma — as VS Code produces
    const jsoncContent = `{
      // MCP servers
      "servers": {
        "my-server": { "command": "my-cmd", "args": [] },
      }
    }`;
    await Bun.write(join(vscodeDir, "mcp.json"), jsoncContent);

    await configureVscodeSettings(tempDir);

    const content = JSON.parse(
      await Bun.file(join(vscodeDir, "mcp.json")).text()
    );
    expect(content.servers["my-server"]).toEqual({
      command: "my-cmd",
      args: [],
    });
    expect(content.servers.archgate).toEqual({
      command: "archgate",
      args: ["mcp"],
    });
  });

  test("returns correct absolute path to mcp.json", async () => {
    const mcpConfigPath = await configureVscodeSettings(tempDir);

    expect(mcpConfigPath).toBe(join(tempDir, ".vscode", "mcp.json"));
  });
});

describe("addMarketplaceToUserSettings", () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-user-settings-test-"));
    originalEnv = process.env.APPDATA;
    process.env.APPDATA = tempDir;
  });

  afterEach(() => {
    process.env.APPDATA = originalEnv;
    rmSync(tempDir, { recursive: true, force: true });
  });

  const URL = "https://user:token@plugins.archgate.dev/archgate.git";

  function settingsPath() {
    return join(tempDir, "Code", "User", "settings.json");
  }

  test("creates settings file when none exists", async () => {
    await addMarketplaceToUserSettings(URL);

    const content = JSON.parse(await Bun.file(settingsPath()).text());
    expect(content["chat.plugins.marketplaces"]).toEqual([URL]);
  });

  test("merges JSONC settings with trailing commas without losing data", async () => {
    const dir = join(tempDir, "Code", "User");
    mkdirSync(dir, { recursive: true });

    const original = `{
  "security.allowedUNCHosts": ["wsl.localhost"],
  "git.autofetch": true,
  "chat.mcp.gallery.enabled": true,
}`;
    await Bun.write(settingsPath(), original);

    await addMarketplaceToUserSettings(URL);

    const content = JSON.parse(await Bun.file(settingsPath()).text());
    expect(content["git.autofetch"]).toBe(true);
    expect(content["chat.mcp.gallery.enabled"]).toBe(true);
    expect(content["security.allowedUNCHosts"]).toEqual(["wsl.localhost"]);
    expect(content["chat.plugins.marketplaces"]).toEqual([URL]);
  });

  test("deduplicates marketplace URLs", async () => {
    const dir = join(tempDir, "Code", "User");
    mkdirSync(dir, { recursive: true });

    await Bun.write(
      settingsPath(),
      JSON.stringify(
        { "chat.plugins.marketplaces": ["https://other.git", URL] },
        null,
        2
      )
    );

    await addMarketplaceToUserSettings(URL);

    const content = JSON.parse(await Bun.file(settingsPath()).text());
    expect(content["chat.plugins.marketplaces"]).toEqual([
      "https://other.git",
      URL,
    ]);
  });
});
