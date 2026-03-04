import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

/**
 * MCP server configuration that archgate injects for Copilot CLI.
 *
 * Copilot CLI uses the same `.github/copilot/mcp.json` format for MCP servers
 * and supports git-based plugin repositories via `copilot plugin install`.
 */
export const ARCHGATE_COPILOT_MCP_CONFIG = {
  mcpServers: {
    archgate: {
      command: "archgate",
      args: ["mcp"],
    },
  },
} as const;

type CopilotMcpConfig = Record<string, unknown>;

/**
 * Pure, additive merge of archgate MCP server config into existing Copilot MCP config.
 *
 * - Preserves all existing MCP server entries
 * - Adds the archgate server only if not already present
 */
export function mergeCopilotMcpConfig(
  existing: CopilotMcpConfig,
  archgate: typeof ARCHGATE_COPILOT_MCP_CONFIG
): CopilotMcpConfig {
  const existingServers =
    typeof existing.mcpServers === "object" &&
    existing.mcpServers !== null &&
    !Array.isArray(existing.mcpServers)
      ? (existing.mcpServers as Record<string, unknown>)
      : {};

  return {
    ...existing,
    mcpServers: {
      ...existingServers,
      ...archgate.mcpServers,
    },
  };
}

/**
 * Configure Copilot CLI settings for archgate integration.
 *
 * Creates/updates `.github/copilot/mcp.json` with archgate MCP server.
 *
 * @returns Absolute path to the MCP config file.
 */
export async function configureCopilotSettings(
  projectRoot: string
): Promise<string> {
  const copilotDir = join(projectRoot, ".github", "copilot");
  const mcpConfigPath = join(copilotDir, "mcp.json");

  // Read existing MCP config or start with empty object
  let existing: CopilotMcpConfig = {};
  if (existsSync(mcpConfigPath)) {
    const content = await Bun.file(mcpConfigPath).text();
    existing = JSON.parse(content) as CopilotMcpConfig;
  }

  const merged = mergeCopilotMcpConfig(existing, ARCHGATE_COPILOT_MCP_CONFIG);

  // Ensure directories exist
  if (!existsSync(copilotDir)) {
    mkdirSync(copilotDir, { recursive: true });
  }

  await Bun.write(mcpConfigPath, JSON.stringify(merged, null, 2) + "\n");

  return mcpConfigPath;
}
