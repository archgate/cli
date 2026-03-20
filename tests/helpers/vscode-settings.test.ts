import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isWindows, isMacOS, isWSL } from "../../src/helpers/platform";
import {
  mergeMarketplaceUrl,
  configureVscodeSettings,
  addMarketplaceToUserSettings,
  getVscodeUserSettingsPath,
} from "../../src/helpers/vscode-settings";

describe("mergeMarketplaceUrl", () => {
  const URL = "https://user:token@plugins.archgate.dev/archgate.git";

  test("includes VS Code defaults when key is absent", () => {
    const result = mergeMarketplaceUrl({}, URL);
    expect(result["chat.plugins.marketplaces"]).toEqual([
      "github/copilot-plugins",
      "github/awesome-copilot",
      URL,
    ]);
  });

  test("appends URL with dedup when key already exists", () => {
    const result = mergeMarketplaceUrl(
      { "chat.plugins.marketplaces": ["https://other.git", URL] },
      URL
    );
    expect(result["chat.plugins.marketplaces"]).toEqual([
      "https://other.git",
      URL,
    ]);
  });

  test("does not re-add defaults when key is explicitly set", () => {
    const result = mergeMarketplaceUrl(
      { "chat.plugins.marketplaces": ["https://custom.git"] },
      URL
    );
    expect(result["chat.plugins.marketplaces"]).toEqual([
      "https://custom.git",
      URL,
    ]);
  });

  test("handles non-array marketplaces gracefully", () => {
    const result = mergeMarketplaceUrl(
      { "chat.plugins.marketplaces": "not-an-array", "editor.fontSize": 14 },
      URL
    );
    expect(result["chat.plugins.marketplaces"]).toEqual([URL]);
    expect(result["editor.fontSize"]).toBe(14);
  });
});

describe("configureVscodeSettings", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-vscode-settings-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates .vscode/ dir when nothing exists", async () => {
    await configureVscodeSettings(tempDir);

    expect(existsSync(join(tempDir, ".vscode"))).toBe(true);
  });

  test("does not create mcp.json", async () => {
    await configureVscodeSettings(tempDir);

    expect(existsSync(join(tempDir, ".vscode", "mcp.json"))).toBe(false);
  });

  test("returns path to .vscode/ directory", async () => {
    const result = await configureVscodeSettings(tempDir);

    expect(result).toBe(join(tempDir, ".vscode"));
  });
});

describe("addMarketplaceToUserSettings", () => {
  let tempDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-user-settings-test-"));
    // Save and override env so getVscodeUserSettingsPath() resolves into tempDir
    savedEnv = { APPDATA: process.env.APPDATA, HOME: process.env.HOME };
    process.env.APPDATA = tempDir; // Windows
    process.env.HOME = tempDir; // macOS/Linux (homedir())
  });

  afterEach(() => {
    Object.assign(process.env, savedEnv);
    rmSync(tempDir, { recursive: true, force: true });
  });

  const URL = "https://user:token@plugins.archgate.dev/archgate.git";

  /** Use the real path resolver so the test matches addMarketplaceToUserSettings */
  async function settingsPath() {
    return await getVscodeUserSettingsPath();
  }

  test("creates settings file with defaults when none exists", async () => {
    await addMarketplaceToUserSettings(URL);

    const path = await settingsPath();
    const content = JSON.parse(await Bun.file(path).text());
    expect(content["chat.plugins.marketplaces"]).toEqual([
      "github/copilot-plugins",
      "github/awesome-copilot",
      URL,
    ]);
  });

  test("merges JSONC settings and includes defaults when key absent", async () => {
    const path = await settingsPath();
    mkdirSync(join(path, ".."), { recursive: true });
    await Bun.write(
      path,
      `{ "git.autofetch": true, "chat.mcp.gallery.enabled": true, }`
    );

    await addMarketplaceToUserSettings(URL);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content["git.autofetch"]).toBe(true);
    expect(content["chat.plugins.marketplaces"]).toEqual([
      "github/copilot-plugins",
      "github/awesome-copilot",
      URL,
    ]);
  });

  test("deduplicates when key already exists", async () => {
    const path = await settingsPath();
    mkdirSync(join(path, ".."), { recursive: true });
    await Bun.write(
      path,
      JSON.stringify({
        "chat.plugins.marketplaces": ["https://other.git", URL],
      })
    );

    await addMarketplaceToUserSettings(URL);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content["chat.plugins.marketplaces"]).toEqual([
      "https://other.git",
      URL,
    ]);
  });
});

describe("getVscodeUserSettingsPath", () => {
  test("returns a string ending in settings.json", async () => {
    const path = await getVscodeUserSettingsPath();
    expect(typeof path).toBe("string");
    expect(path.endsWith("settings.json")).toBe(true);
  });

  test("always includes Code/User/settings.json in path", async () => {
    const path = await getVscodeUserSettingsPath();
    // Normalize separators so the assertion works cross-platform
    const normalized = path.replaceAll("\\", "/");
    expect(normalized).toContain("Code/User/settings.json");
  });

  test("returns platform-appropriate path", async () => {
    const path = await getVscodeUserSettingsPath();
    const normalized = path.replaceAll("\\", "/");

    if (isWindows()) {
      // Windows: %APPDATA%/Code/User/settings.json
      const appData = (
        process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
      ).replaceAll("\\", "/");
      expect(normalized.startsWith(appData.replaceAll("\\", "/"))).toBe(true);
    } else if (isMacOS()) {
      // macOS: ~/Library/Application Support/Code/User/settings.json
      expect(normalized).toContain(
        "Library/Application Support/Code/User/settings.json"
      );
    } else if (!isWSL()) {
      // Linux (non-WSL): ~/.config/Code/User/settings.json
      const home = homedir().replaceAll("\\", "/");
      expect(normalized.startsWith(home)).toBe(true);
      expect(normalized).toContain(".config/Code/User/settings.json");
    }
  });

  test("falls back to AppData/Roaming when APPDATA is unset on Windows", async () => {
    if (!isWindows()) return; // Only meaningful on Windows

    const savedAppData = process.env.APPDATA;
    try {
      delete process.env.APPDATA;
      const path = await getVscodeUserSettingsPath();
      const normalized = path.replaceAll("\\", "/");
      // Should fall back to homedir()/AppData/Roaming
      expect(normalized).toContain("AppData/Roaming/Code/User/settings.json");
    } finally {
      if (savedAppData !== undefined) {
        process.env.APPDATA = savedAppData;
      }
    }
  });
});
