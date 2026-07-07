// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

const ClaudePermissionsSchema = z
  .object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  })
  .passthrough();

const ClaudeSettingsSchema = z
  .object({
    agent: z.string().optional(),
    permissions: ClaudePermissionsSchema.optional(),
  })
  .passthrough();

type ClaudeSettings = z.infer<typeof ClaudeSettingsSchema>;

/**
 * Settings that archgate injects into .claude/settings.local.json.
 * Scalar keys are set only if absent; array keys are appended with dedup.
 */
export const ARCHGATE_CLAUDE_SETTINGS = {
  agent: "archgate:developer",
  permissions: {
    allow: [
      "Skill(archgate:architect)",
      "Skill(archgate:quality-manager)",
      "Skill(archgate:adr-author)",
    ],
  },
} as const;

/**
 * Deduplicate an array of strings while preserving order.
 */
function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Pure, additive merge of archgate settings into existing Claude settings.
 *
 * - Scalar keys (`agent`): set only if absent
 * - Array keys (`permissions.allow`): append with dedup
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

  // Nested permissions object: merge allow array with dedup, preserve deny
  const existingPermissions = merged.permissions ?? {};
  const existingAllow = existingPermissions.allow ?? [];

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
    try {
      const result = ClaudeSettingsSchema.safeParse(
        await Bun.file(settingsPath).json()
      );
      if (result.success) existing = result.data;
    } catch {
      // Corrupted settings file — start fresh
    }
  }

  const merged = mergeClaudeSettings(existing, ARCHGATE_CLAUDE_SETTINGS);

  // Ensure .claude/ directory exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  await Bun.write(settingsPath, JSON.stringify(merged, null, 2) + "\n");

  return settingsPath;
}
