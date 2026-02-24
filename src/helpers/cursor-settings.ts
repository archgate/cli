import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

/**
 * MCP server configuration that archgate injects into .cursor/mcp.json.
 * Follows the same structure Cursor uses for MCP server registration.
 */
export const ARCHGATE_CURSOR_MCP_CONFIG = {
  mcpServers: {
    archgate: {
      command: "archgate",
      args: ["mcp"],
    },
  },
} as const;

/**
 * Content for .cursor/rules/archgate-governance.mdc.
 * Uses alwaysApply: true so the agent always has governance context.
 */
export const ARCHGATE_CURSOR_RULE = `---
description: Archgate ADR governance — enforces architecture decision records
globs:
alwaysApply: true
---

# Archgate Governance

This project uses Archgate to enforce Architecture Decision Records (ADRs).

## Before writing code

- Use the \`review_context\` MCP tool to get applicable ADR briefings for changed files
- Review the Decision and Do's/Don'ts sections of each applicable ADR

## After writing code

- Run the \`check\` MCP tool to validate compliance with all ADR rules
- Fix any violations before considering work complete

## ADR commands

- \`list_adrs\` — List all active ADRs with metadata
- \`check\` — Run automated compliance checks (use \`staged: true\` for pre-commit)
- \`review_context\` — Get changed files grouped by domain with ADR briefings

## Key principle

Architectural decisions are enforced, not suggested. If \`check\` reports violations, they must be fixed.
`;

type CursorMcpConfig = Record<string, unknown>;

/**
 * Pure, additive merge of archgate MCP server config into existing Cursor MCP config.
 *
 * - Preserves all existing MCP server entries
 * - Adds the archgate server only if not already present
 */
export function mergeCursorMcpConfig(
  existing: CursorMcpConfig,
  archgate: typeof ARCHGATE_CURSOR_MCP_CONFIG
): CursorMcpConfig {
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
 * Configure Cursor settings for archgate integration.
 *
 * Creates/updates `.cursor/mcp.json` with archgate MCP server and
 * writes `.cursor/rules/archgate-governance.mdc` with always-on governance rule.
 *
 * @returns Absolute path to the MCP config file.
 */
export async function configureCursorSettings(
  projectRoot: string
): Promise<string> {
  const cursorDir = join(projectRoot, ".cursor");
  const mcpConfigPath = join(cursorDir, "mcp.json");
  const rulesDir = join(cursorDir, "rules");
  const rulePath = join(rulesDir, "archgate-governance.mdc");

  // Read existing MCP config or start with empty object
  let existing: CursorMcpConfig = {};
  if (existsSync(mcpConfigPath)) {
    const content = await Bun.file(mcpConfigPath).text();
    existing = JSON.parse(content) as CursorMcpConfig;
  }

  const merged = mergeCursorMcpConfig(existing, ARCHGATE_CURSOR_MCP_CONFIG);

  // Ensure directories exist
  if (!existsSync(cursorDir)) {
    mkdirSync(cursorDir, { recursive: true });
  }
  if (!existsSync(rulesDir)) {
    mkdirSync(rulesDir, { recursive: true });
  }

  await Bun.write(mcpConfigPath, JSON.stringify(merged, null, 2) + "\n");
  await Bun.write(rulePath, ARCHGATE_CURSOR_RULE);

  return mcpConfigPath;
}
