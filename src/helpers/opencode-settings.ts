// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * opencode-settings.ts — Configure opencode user-scope settings.
 *
 * Writes `opencode.json` to the XDG config directory
 * (`~/.config/opencode/opencode.json`) with `default_agent` set to
 * `archgate-developer`. Merges additively — existing user settings
 * are preserved.
 *
 * opencode resolves its config via `xdg-basedir`, which falls back to
 * `~/.config` on all platforms (including Windows). The path resolution
 * uses `opencodeConfigDir()` from `paths.ts`.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { logDebug } from "./log";
import { opencodeConfigDir } from "./paths";

/** The agent name used in opencode's `default_agent` config field. */
const DEFAULT_AGENT = "archgate-developer";

type OpencodeConfig = Record<string, unknown>;

/**
 * Pure, additive merge of archgate settings into existing opencode config.
 *
 * - `default_agent`: set only if absent (never overwrite user's choice)
 * - All existing user settings are preserved (unknown keys pass through)
 */
export function mergeOpencodeSettings(
  existing: OpencodeConfig
): OpencodeConfig {
  const merged: OpencodeConfig = { ...existing };

  if (!("default_agent" in merged)) {
    merged.default_agent = DEFAULT_AGENT;
  }

  return merged;
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
      existing = (await Bun.file(configPath).json()) as OpencodeConfig;
    } catch {
      // Corrupted config file — start fresh
    }
  }

  const merged = mergeOpencodeSettings(existing);

  // Ensure parent directory exists
  const dir = opencodeConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  logDebug("Writing opencode config:", configPath);
  await Bun.write(configPath, JSON.stringify(merged, null, 2) + "\n");

  return configPath;
}
