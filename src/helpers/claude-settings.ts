import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

/**
 * Settings that archgate injects into .claude/settings.local.json.
 * Scalar keys are set only if absent; array keys are appended with dedup.
 */
export const ARCHGATE_CLAUDE_SETTINGS = {
  agent: "archgate:developer",
  enableAllProjectMcpServers: true,
  enabledMcpjsonServers: ["archgate"],
  permissions: {
    allow: [
      "mcp__plugin_archgate_archgate__*",
      "Skill(archgate:architect)",
      "Skill(archgate:quality-manager)",
      "Skill(archgate:adr-author)",
    ],
  },
} as const;

type ClaudeSettings = Record<string, unknown>;

/**
 * Deduplicate an array of strings while preserving order.
 */
function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Pure, additive merge of archgate settings into existing Claude settings.
 *
 * - Scalar keys (`agent`, `enableAllProjectMcpServers`): set only if absent
 * - Array keys (`enabledMcpjsonServers`, `permissions.allow`): append with dedup
 * - All existing user settings are preserved (unknown keys pass through)
 */
export function mergeClaudeSettings(
  existing: ClaudeSettings,
  archgate: typeof ARCHGATE_CLAUDE_SETTINGS
): ClaudeSettings {
  const merged: ClaudeSettings = { ...existing };

  // Scalar: set only if absent
  if (!("agent" in merged)) {
    merged.agent = archgate.agent;
  }
  if (!("enableAllProjectMcpServers" in merged)) {
    merged.enableAllProjectMcpServers = archgate.enableAllProjectMcpServers;
  }

  // Array: append with dedup
  const existingMcpServers = Array.isArray(merged.enabledMcpjsonServers)
    ? (merged.enabledMcpjsonServers as string[])
    : [];
  merged.enabledMcpjsonServers = dedup([
    ...existingMcpServers,
    ...archgate.enabledMcpjsonServers,
  ]);

  // Nested permissions object: merge allow array with dedup, preserve deny
  const existingPermissions =
    typeof merged.permissions === "object" &&
    merged.permissions !== null &&
    !Array.isArray(merged.permissions)
      ? (merged.permissions as Record<string, unknown>)
      : {};

  const existingAllow = Array.isArray(existingPermissions.allow)
    ? (existingPermissions.allow as string[])
    : [];

  merged.permissions = {
    ...existingPermissions,
    allow: dedup([...existingAllow, ...archgate.permissions.allow]),
  };

  return merged;
}

/**
 * Configure Claude Code settings for archgate integration.
 *
 * Reads existing `.claude/settings.local.json` (if any), merges archgate
 * settings additively, and writes the result. Creates `.claude/` dir if missing.
 *
 * @returns Absolute path to the settings file.
 */
export async function configureClaudeSettings(
  projectRoot: string
): Promise<string> {
  const claudeDir = join(projectRoot, ".claude");
  const settingsPath = join(claudeDir, "settings.local.json");

  // Read existing settings or start with empty object
  let existing: ClaudeSettings = {};
  if (existsSync(settingsPath)) {
    const content = await Bun.file(settingsPath).text();
    existing = JSON.parse(content) as ClaudeSettings;
  }

  const merged = mergeClaudeSettings(existing, ARCHGATE_CLAUDE_SETTINGS);

  // Ensure .claude/ directory exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  await Bun.write(settingsPath, JSON.stringify(merged, null, 2) + "\n");

  return settingsPath;
}
