// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isWindows,
  isMacOS,
  isWSL,
  _resetAllCaches,
} from "../../src/helpers/platform";
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
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-vscode-settings-test-"));
    savedEnv = { APPDATA: process.env.APPDATA, HOME: process.env.HOME };
    process.env.APPDATA = tempDir;
    process.env.HOME = tempDir;
  });

  afterEach(() => {
    Object.assign(process.env, savedEnv);
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("does not create .vscode/ dir when no marketplace URL is provided", async () => {
    await configureVscodeSettings(tempDir);

    expect(existsSync(join(tempDir, ".vscode"))).toBe(false);
  });

  test("returns path to .vscode/ directory", async () => {
    const result = await configureVscodeSettings(tempDir);

    expect(result).toBe(join(tempDir, ".vscode"));
  });

  test("does not create user settings file when no marketplace URL is provided", async () => {
    await configureVscodeSettings(tempDir);

    // The user settings file should not be created
    const path = await getVscodeUserSettingsPath();
    expect(existsSync(path)).toBe(false);
  });

  test("creates .vscode/ dir when marketplace URL is provided", async () => {
    const url = "https://user:token@plugins.archgate.dev/archgate.git";
    await configureVscodeSettings(tempDir, url);

    expect(existsSync(join(tempDir, ".vscode"))).toBe(true);
  });

  test("does not recreate .vscode/ dir when it already exists", async () => {
    const url = "https://user:token@plugins.archgate.dev/archgate.git";
    const vscodeDir = join(tempDir, ".vscode");
    mkdirSync(vscodeDir, { recursive: true });

    // Place a marker file to verify the dir is not replaced
    const markerPath = join(vscodeDir, "marker.txt");
    await Bun.write(markerPath, "exists");

    await configureVscodeSettings(tempDir, url);

    expect(existsSync(markerPath)).toBe(true);
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

  test("creates directory structure when settings dir does not exist", async () => {
    // Ensure the target settings directory does not exist yet
    const path = await settingsPath();
    const dir = join(path, "..");
    expect(existsSync(dir)).toBe(false);

    await addMarketplaceToUserSettings(URL);

    expect(existsSync(path)).toBe(true);
    const content = JSON.parse(await Bun.file(path).text());
    expect(content["chat.plugins.marketplaces"]).toContain(URL);
  });

  test("preserves all existing keys when merging", async () => {
    const path = await settingsPath();
    mkdirSync(join(path, ".."), { recursive: true });
    await Bun.write(
      path,
      JSON.stringify({
        "editor.fontSize": 14,
        "editor.tabSize": 2,
        "workbench.colorTheme": "One Dark Pro",
      })
    );

    await addMarketplaceToUserSettings(URL);

    const content = JSON.parse(await Bun.file(path).text());
    expect(content["editor.fontSize"]).toBe(14);
    expect(content["editor.tabSize"]).toBe(2);
    expect(content["workbench.colorTheme"]).toBe("One Dark Pro");
    expect(content["chat.plugins.marketplaces"]).toContain(URL);
  });

  test("returns the settings file path", async () => {
    const returnedPath = await addMarketplaceToUserSettings(URL);
    const expectedPath = await settingsPath();
    expect(returnedPath).toBe(expectedPath);
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

  test.skipIf(process.platform !== "linux" || !!process.env.WSL_DISTRO_NAME)(
    "WSL branch falls back to Linux path when cmd.exe unavailable",
    async () => {
      const savedDistro = process.env.WSL_DISTRO_NAME;
      try {
        process.env.WSL_DISTRO_NAME = "FakeWSL";
        _resetAllCaches();
        const path = await getVscodeUserSettingsPath();
        const normalized = path.replaceAll("\\", "/");
        expect(normalized).toContain(".config/Code/User/settings.json");
      } finally {
        if (savedDistro === undefined) delete process.env.WSL_DISTRO_NAME;
        else process.env.WSL_DISTRO_NAME = savedDistro;
        _resetAllCaches();
      }
    }
  );

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
