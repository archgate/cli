// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Configure opencode user-scope settings: writes `opencode.json` in the XDG
 * config directory (resolved by `opencodeConfigDir()` in `paths.ts`) with
 * `default_agent: archgate-developer`, merging additively so existing user
 * settings are preserved.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { logDebug } from "./log";
import { opencodeConfigDir } from "./paths";

/** The agent name used in opencode's `default_agent` config field. */
const DEFAULT_AGENT = "archgate-developer";

const OpencodeConfigSchema = z
  // oxlint-disable-next-line no-useless-undefined -- Zod .catch() requires explicit default
  .looseObject({ default_agent: z.string().optional().catch(undefined) });

type OpencodeConfig = z.infer<typeof OpencodeConfigSchema>;

/**
 * Pure, additive merge of archgate settings into existing opencode config.
 *
 * - `default_agent`: set only if absent (never overwrite user's choice)
 * - All existing user settings are preserved (unknown keys pass through)
 */
export function mergeOpencodeSettings(
  existing: OpencodeConfig
): OpencodeConfig {
  if (!("default_agent" in existing)) {
    existing.default_agent = DEFAULT_AGENT;
  }

  return existing;
}

/**
 * Resolve the path to the opencode user-scope config file.
 *
 * The config lives in the same XDG config directory as the agents:
 * `~/.config/opencode/opencode.json`. Uses the same resolution logic
 * as `opencodeAgentsDir()` to stay consistent.
 */
export function opencodeConfigPath(): string {
  return join(opencodeConfigDir(), "opencode.json");
}

/**
 * Configure opencode settings for archgate integration.
 *
 * Reads existing `opencode.json` (if any), merges archgate settings
 * additively, and writes the result. Creates parent directories if missing.
 *
 * @returns Absolute path to the config file.
 */
export async function configureOpencodeSettings(): Promise<string> {
  const configPath = opencodeConfigPath();

  let existing: OpencodeConfig = {};
  if (existsSync(configPath)) {
    try {
      const result = OpencodeConfigSchema.safeParse(
        await Bun.file(configPath).json()
      );
      if (result.success) existing = result.data;
    } catch {
      // Corrupted config file — start fresh
    }
  }

  const merged = mergeOpencodeSettings(existing);

  const dir = opencodeConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  logDebug("Writing opencode config:", configPath);
  await Bun.write(configPath, JSON.stringify(merged, null, 2) + "\n");

  return configPath;
}
