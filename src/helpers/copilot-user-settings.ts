// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * User-scope GitHub Copilot settings (`~/.copilot/settings.json`), read by
 * both the `copilot` CLI and the desktop app: `extraKnownMarketplaces` is the
 * marketplace registry, `enabledPlugins` a declarative auto-install list —
 * writing both installs the plugin without the CLI on PATH. Project-scope
 * config (`.github/copilot/`) lives in `copilot-settings.ts`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { copilotConfigDir } from "./paths";

/** Marketplace key and plugin spec used by Copilot for the archgate plugin. */
const MARKETPLACE_KEY = "archgate";
const PLUGIN_SPEC = "archgate@archgate";

/** Exported for testing only. */
export const CopilotUserSettingsSchema = z
  .object({
    extraKnownMarketplaces: z
      .record(z.string(), z.unknown())
      .optional()
      .catch({}),
    enabledPlugins: z.record(z.string(), z.boolean()).optional().catch({}),
  })
  .loose();

type CopilotUserSettings = z.infer<typeof CopilotUserSettingsSchema>;

/**
 * Declare the archgate marketplace and enable the archgate plugin, preserving
 * all other settings, marketplaces, and plugin entries. An existing
 * `archgate` marketplace entry is overwritten to correct stale URLs, which
 * `copilot plugin marketplace add` never fixes ("already registered").
 */
export function mergeCopilotPluginSettings(
  existing: CopilotUserSettings,
  marketplaceUrl: string
): CopilotUserSettings {
  const marketplaces = existing.extraKnownMarketplaces ?? {};
  marketplaces[MARKETPLACE_KEY] = {
    source: { source: "git", url: marketplaceUrl },
  };
  existing.extraKnownMarketplaces = marketplaces;

  const plugins = existing.enabledPlugins ?? {};
  plugins[PLUGIN_SPEC] = true;
  existing.enabledPlugins = plugins;

  return existing;
}

/**
 * Write the archgate marketplace + plugin declaration into
 * `~/.copilot/settings.json`. Reads the file as JSONC, merges via
 * {@link mergeCopilotPluginSettings}, writes back plain JSON (comments are
 * dropped — same trade-off as `vscode-settings.ts`); a malformed file is
 * replaced. Callers gate on `isCopilotAvailable()` before invoking.
 *
 * @returns Absolute path to the settings file written.
 */
export async function configureCopilotUserSettings(
  marketplaceUrl: string
): Promise<string> {
  const settingsPath = join(copilotConfigDir(), "settings.json");

  let existing: CopilotUserSettings = {};
  if (existsSync(settingsPath)) {
    try {
      const content = await Bun.file(settingsPath).text();
      const result = CopilotUserSettingsSchema.safeParse(
        Bun.JSONC.parse(content)
      );
      if (result.success) existing = result.data;
    } catch {
      // Malformed settings file — start fresh
    }
  }

  const merged = mergeCopilotPluginSettings(existing, marketplaceUrl);
  await Bun.write(settingsPath, JSON.stringify(merged, null, 2) + "\n");

  return settingsPath;
}
