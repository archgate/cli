import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  getWindowsHomeDirFromWSL,
  isMacOS,
  isWSL,
  isWindows,
} from "./platform";

type VscodeUserSettings = Record<string, unknown>;

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
 * - WSL:     Windows-side AppData path (VS Code runs on Windows)
 */
export async function getVscodeUserSettingsPath(): Promise<string> {
  if (isWindows()) {
    const appData =
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "Code", "User", "settings.json");
  }
  if (isMacOS()) {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Code",
      "User",
      "settings.json"
    );
  }
  // WSL: VS Code runs on the Windows side, so resolve Windows AppData path
  if (isWSL()) {
    const winHome = await getWindowsHomeDirFromWSL();
    if (winHome) {
      return join(
        winHome,
        "AppData",
        "Roaming",
        "Code",
        "User",
        "settings.json"
      );
    }
    // Fall through to Linux path if Windows home not resolvable
  }
  // Linux and others
  return join(homedir(), ".config", "Code", "User", "settings.json");
}

/**
 * Configure VS Code settings for archgate integration.
 *
 * If `marketplaceUrl` is provided, adds it to `chat.plugins.marketplaces` in
 * the VS Code user-level settings.json (application-scoped — cannot be set per workspace).
 *
 * @returns Absolute path to the .vscode/ directory.
 */
export async function configureVscodeSettings(
  projectRoot: string,
  marketplaceUrl?: string
): Promise<string> {
  const vscodeDir = join(projectRoot, ".vscode");

  if (!existsSync(vscodeDir)) {
    mkdirSync(vscodeDir, { recursive: true });
  }

  // --- User-level: chat.plugins.marketplaces ---
  if (marketplaceUrl) {
    await addMarketplaceToUserSettings(marketplaceUrl);
  }

  return vscodeDir;
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
  const settingsPath = await getVscodeUserSettingsPath();
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
