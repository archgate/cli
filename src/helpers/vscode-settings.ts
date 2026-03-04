import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

/**
 * VS Code settings that archgate injects into .vscode/settings.json.
 *
 * - `chat.plugins.marketplaces`: registers the archgate git marketplace so
 *   VS Code's agent plugin system can discover and install the plugin.
 * - MCP server configuration for the archgate governance tools.
 */
export const ARCHGATE_VSCODE_SETTINGS = {
  "chat.plugins.marketplaces": [] as string[],
  mcp: {
    servers: {
      archgate: {
        command: "archgate",
        args: ["mcp"],
      },
    },
  },
} as const;

type VscodeSettings = Record<string, unknown>;

/**
 * Deduplicate an array of strings while preserving order.
 */
function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Pure, additive merge of archgate settings into existing VS Code settings.
 *
 * - `chat.plugins.marketplaces`: append marketplace URL with dedup
 * - `mcp.servers`: add archgate server, preserve existing servers
 * - All existing user settings are preserved (unknown keys pass through)
 */
export function mergeVscodeSettings(
  existing: VscodeSettings,
  marketplaceUrl: string
): VscodeSettings {
  const merged: VscodeSettings = { ...existing };

  // Marketplace URLs: append with dedup
  const existingMarketplaces = Array.isArray(
    merged["chat.plugins.marketplaces"]
  )
    ? (merged["chat.plugins.marketplaces"] as string[])
    : [];
  merged["chat.plugins.marketplaces"] = dedup([
    ...existingMarketplaces,
    marketplaceUrl,
  ]);

  // MCP servers: additive merge
  const existingMcp =
    typeof merged.mcp === "object" &&
    merged.mcp !== null &&
    !Array.isArray(merged.mcp)
      ? (merged.mcp as Record<string, unknown>)
      : {};

  const existingServers =
    typeof existingMcp.servers === "object" &&
    existingMcp.servers !== null &&
    !Array.isArray(existingMcp.servers)
      ? (existingMcp.servers as Record<string, unknown>)
      : {};

  merged.mcp = {
    ...existingMcp,
    servers: {
      ...existingServers,
      ...ARCHGATE_VSCODE_SETTINGS.mcp.servers,
    },
  };

  return merged;
}

/**
 * Configure VS Code settings for archgate integration.
 *
 * Reads existing `.vscode/settings.json` (if any), merges archgate
 * settings additively (marketplace URL + MCP server), and writes the result.
 *
 * @returns Absolute path to the settings file.
 */
export async function configureVscodeSettings(
  projectRoot: string,
  marketplaceUrl: string
): Promise<string> {
  const vscodeDir = join(projectRoot, ".vscode");
  const settingsPath = join(vscodeDir, "settings.json");

  // Read existing settings or start with empty object
  let existing: VscodeSettings = {};
  if (existsSync(settingsPath)) {
    const content = await Bun.file(settingsPath).text();
    existing = JSON.parse(content) as VscodeSettings;
  }

  const merged = mergeVscodeSettings(existing, marketplaceUrl);

  // Ensure .vscode/ directory exists
  if (!existsSync(vscodeDir)) {
    mkdirSync(vscodeDir, { recursive: true });
  }

  await Bun.write(settingsPath, JSON.stringify(merged, null, 2) + "\n");

  return settingsPath;
}
