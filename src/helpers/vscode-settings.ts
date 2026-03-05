import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

/**
 * MCP server configuration that archgate injects into .vscode/mcp.json.
 *
 * VS Code uses a dedicated `.vscode/mcp.json` file for MCP server registration
 * (not `.vscode/settings.json`). The `servers` key format is defined by VS Code's
 * MCP configuration spec.
 */
export const ARCHGATE_VSCODE_MCP_CONFIG = {
  servers: {
    archgate: {
      command: "archgate",
      args: ["mcp"],
    },
  },
} as const;

type VscodeMcpConfig = Record<string, unknown>;
type VscodeUserSettings = Record<string, unknown>;

/**
 * Pure, additive merge of archgate MCP server config into existing VS Code MCP config.
 *
 * - Preserves all existing MCP server entries
 * - Adds the archgate server (overwrites if already present)
 */
export function mergeVscodeMcpConfig(
  existing: VscodeMcpConfig,
  archgate: typeof ARCHGATE_VSCODE_MCP_CONFIG
): VscodeMcpConfig {
  const existingServers =
    typeof existing.servers === "object" &&
    existing.servers !== null &&
    !Array.isArray(existing.servers)
      ? (existing.servers as Record<string, unknown>)
      : {};

  return {
    ...existing,
    servers: {
      ...existingServers,
      ...archgate.servers,
    },
  };
}

/**
 * VS Code's built-in default marketplaces for `chat.plugins.marketplaces`.
 *
 * These are implicit defaults — VS Code uses them when the setting is absent
 * from the user's settings.json. Once we explicitly set the key, VS Code stops
 * using its defaults, so we must include them to avoid losing them.
 */
const VSCODE_DEFAULT_MARKETPLACES = [
  "github/copilot-plugins",
  "github/awesome-copilot",
];

/**
 * Deduplicate an array of strings while preserving order.
 */
function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Add a marketplace URL to the `chat.plugins.marketplaces` array in a VS Code
 * user settings object. Preserves all other settings. Deduplicates URLs.
 *
 * When `chat.plugins.marketplaces` is not yet in the file, VS Code's built-in
 * defaults are included so they are not lost when we explicitly set the key.
 */
export function mergeMarketplaceUrl(
  existing: VscodeUserSettings,
  marketplaceUrl: string
): VscodeUserSettings {
  const merged: VscodeUserSettings = { ...existing };

  const hasExplicitMarketplaces = "chat.plugins.marketplaces" in existing;
  const existingMarketplaces = Array.isArray(
    merged["chat.plugins.marketplaces"]
  )
    ? (merged["chat.plugins.marketplaces"] as string[])
    : [];

  // When the key is absent, seed with VS Code's built-in defaults so we don't
  // silently override them by setting the key explicitly.
  const base = hasExplicitMarketplaces
    ? existingMarketplaces
    : [...VSCODE_DEFAULT_MARKETPLACES, ...existingMarketplaces];

  merged["chat.plugins.marketplaces"] = dedup([...base, marketplaceUrl]);

  return merged;
}

/**
 * Resolve the path to VS Code's user-level settings.json.
 *
 * - Windows: %APPDATA%/Code/User/settings.json
 * - macOS:   ~/Library/Application Support/Code/User/settings.json
 * - Linux:   ~/.config/Code/User/settings.json
 */
export function getVscodeUserSettingsPath(): string {
  const platform = process.platform;
  if (platform === "win32") {
    const appData =
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "Code", "User", "settings.json");
  }
  if (platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Code",
      "User",
      "settings.json"
    );
  }
  // Linux and others
  return join(homedir(), ".config", "Code", "User", "settings.json");
}

/**
 * Configure VS Code settings for archgate integration.
 *
 * 1. Creates/updates `.vscode/mcp.json` (workspace-level) with the Archgate MCP server.
 * 2. If `marketplaceUrl` is provided, adds it to `chat.plugins.marketplaces` in
 *    the VS Code user-level settings.json (application-scoped — cannot be set per workspace).
 *
 * @returns Absolute path to the workspace MCP config file.
 */
export async function configureVscodeSettings(
  projectRoot: string,
  marketplaceUrl?: string
): Promise<string> {
  const vscodeDir = join(projectRoot, ".vscode");
  const mcpConfigPath = join(vscodeDir, "mcp.json");

  // --- Workspace: .vscode/mcp.json ---
  let existing: VscodeMcpConfig = {};
  if (existsSync(mcpConfigPath)) {
    const content = await Bun.file(mcpConfigPath).text();
    existing = Bun.JSONC.parse(content) as VscodeMcpConfig;
  }

  const merged = mergeVscodeMcpConfig(existing, ARCHGATE_VSCODE_MCP_CONFIG);

  if (!existsSync(vscodeDir)) {
    mkdirSync(vscodeDir, { recursive: true });
  }

  await Bun.write(mcpConfigPath, JSON.stringify(merged, null, 2) + "\n");

  // --- User-level: chat.plugins.marketplaces ---
  if (marketplaceUrl) {
    await addMarketplaceToUserSettings(marketplaceUrl);
  }

  return mcpConfigPath;
}

/**
 * Add the marketplace URL to VS Code's user-level settings.json.
 *
 * Reads the existing file with `Bun.JSONC.parse` (supports comments and
 * trailing commas), merges the marketplace URL, and writes back as standard
 * JSON. Comments in the original file are not preserved — VS Code re-reads
 * the file without issue.
 */
export async function addMarketplaceToUserSettings(
  marketplaceUrl: string
): Promise<string> {
  const settingsPath = getVscodeUserSettingsPath();
  const settingsDir = join(settingsPath, "..");

  let existing: VscodeUserSettings = {};
  if (existsSync(settingsPath)) {
    const content = await Bun.file(settingsPath).text();
    existing = Bun.JSONC.parse(content) as VscodeUserSettings;
  }

  const merged = mergeMarketplaceUrl(existing, marketplaceUrl);

  if (!existsSync(settingsDir)) {
    mkdirSync(settingsDir, { recursive: true });
  }

  await Bun.write(settingsPath, JSON.stringify(merged, null, 2) + "\n");

  return settingsPath;
}
