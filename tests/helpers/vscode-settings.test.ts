// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  type Mock,
  spyOn,
} from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import {
  isWindows,
  isMacOS,
  isWSL,
  _resetAllCaches,
} from "../../src/helpers/platform";
import {
  VscodeSettingsSchema,
  mergeMarketplaceUrl,
  configureVscodeSettings,
  addMarketplaceToUserSettings,
  getVscodeUserSettingsPath,
} from "../../src/helpers/vscode-settings";
import { restoreEnv } from "../test-utils";

/**
 * Bulk form of `restoreEnv` for the snapshot-many-vars pattern used below:
 * restores saved env vars, deleting keys that were unset at capture time.
 *
 * Neither `Object.assign(process.env, saved)` nor a plain `env[k] = v` loop
 * works — both stringify `undefined` into the literal "undefined", corrupting
 * the env for subsequent test files (ARCH-005).
 */
function restoreEnvAll(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    restoreEnv(key, value);
  }
}

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

  test("handles missing marketplaces gracefully", () => {
    const result = mergeMarketplaceUrl({ "editor.fontSize": 14 }, URL);
    expect(result["chat.plugins.marketplaces"]).toEqual([
      "github/copilot-plugins",
      "github/awesome-copilot",
      URL,
    ]);
    expect(result["editor.fontSize"]).toBe(14);
  });

  test("handles non-array marketplaces gracefully via schema catch", () => {
    const parsed = VscodeSettingsSchema.parse({
      "chat.plugins.marketplaces": "not-an-array",
      "editor.fontSize": 14,
    });
    const result = mergeMarketplaceUrl(parsed, URL);
    // Invalid value is caught to [] — treated as explicitly set (no defaults seeded)
    expect(result["chat.plugins.marketplaces"]).toEqual([URL]);
    expect(result["editor.fontSize"]).toBe(14);
  });
});

describe("configureVscodeSettings", () => {
  let tempDir: string;
  let savedEnv: Record<string, string | undefined>;
  let homedirSpy: Mock<typeof os.homedir>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(os.tmpdir(), "archgate-vscode-settings-test-"));
    // Redirect user-scope path resolution into tempDir so these tests NEVER
    // touch the real VS Code settings.json:
    // - Windows branch reads Bun.env.APPDATA → env override works
    // - macOS/Linux branches call os.homedir() → must be mocked, because Bun
    //   caches homedir() on Linux and ignores runtime HOME env overrides
    savedEnv = { APPDATA: process.env.APPDATA };
    process.env.APPDATA = tempDir;
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempDir);
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    restoreEnvAll(savedEnv);
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
  let homedirSpy: Mock<typeof os.homedir>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(os.tmpdir(), "archgate-user-settings-test-"));
    // Redirect user-scope path resolution into tempDir so these tests NEVER
    // touch the real VS Code settings.json (see configureVscodeSettings above).
    savedEnv = { APPDATA: process.env.APPDATA };
    process.env.APPDATA = tempDir; // Windows
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempDir); // macOS/Linux
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    restoreEnvAll(savedEnv);
    rmSync(tempDir, { recursive: true, force: true });
  });

  const URL = "https://user:token@plugins.archgate.dev/archgate.git";

  /** Use the real path resolver so the test matches addMarketplaceToUserSettings */
  async function settingsPath() {
    return getVscodeUserSettingsPath();
  }

  test("creates settings file with defaults when none exists", async () => {
    await addMarketplaceToUserSettings(URL);

    const path = await settingsPath();
    const content = VscodeSettingsSchema.parse(
      JSON.parse(await Bun.file(path).text())
    );
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

    const content = VscodeSettingsSchema.parse(
      JSON.parse(await Bun.file(path).text())
    );
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

    const content = VscodeSettingsSchema.parse(
      JSON.parse(await Bun.file(path).text())
    );
    expect(content["chat.plugins.marketplaces"]).toEqual([
      "https://other.git",
      URL,
    ]);
  });

  test("creates settings file even when parent dirs do not exist yet", async () => {
    // Use a deeply nested subdir that definitely doesn't exist yet
    const deepHome = join(tempDir, "non", "existent", "deep");
    process.env.APPDATA = deepHome; // Windows
    homedirSpy.mockReturnValue(deepHome); // macOS/Linux

    await addMarketplaceToUserSettings(URL);

    const path = await settingsPath();
    expect(existsSync(path)).toBe(true);
    const content = VscodeSettingsSchema.parse(
      JSON.parse(await Bun.file(path).text())
    );
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

    const content = VscodeSettingsSchema.parse(
      JSON.parse(await Bun.file(path).text())
    );
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
        process.env.APPDATA ?? join(os.homedir(), "AppData", "Roaming")
      ).replaceAll("\\", "/");
      expect(normalized.startsWith(appData.replaceAll("\\", "/"))).toBe(true);
    } else if (isMacOS()) {
      // macOS: ~/Library/Application Support/Code/User/settings.json
      expect(normalized).toContain(
        "Library/Application Support/Code/User/settings.json"
      );
    } else if (!isWSL()) {
      // Linux (non-WSL): ~/.config/Code/User/settings.json
      const home = os.homedir().replaceAll("\\", "/");
      expect(normalized.startsWith(home)).toBe(true);
      expect(normalized).toContain(".config/Code/User/settings.json");
    }
  });

  test.skipIf(
    process.platform !== "linux" ||
      (process.env.WSL_DISTRO_NAME !== undefined &&
        process.env.WSL_DISTRO_NAME !== "")
  )(
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
        restoreEnv("WSL_DISTRO_NAME", savedDistro);
        _resetAllCaches();
      }
    }
  );

  test.skipIf(!isWindows())(
    "falls back to AppData/Roaming when APPDATA is unset on Windows",
    async () => {
      const savedAppData = process.env.APPDATA;
      try {
        delete process.env.APPDATA;
        const path = await getVscodeUserSettingsPath();
        const normalized = path.replaceAll("\\", "/");
        expect(normalized).toContain("AppData/Roaming/Code/User/settings.json");
      } finally {
        restoreEnv("APPDATA", savedAppData);
      }
    }
  );
});

/**
 * `getVscodeUserSettingsPath()` branches on `src/helpers/platform.ts`, which
 * resolves `process.platform` at call time. Bun exposes that as a writable
 * property, so simulating it and clearing the platform cache reaches the macOS
 * and WSL branches from any runner.
 */
describe("getVscodeUserSettingsPath branch matrix", () => {
  const HOME = "/simulated-home";
  const APP_DATA = "/simulated-appdata";
  const WIN_HOME = "/mnt/c/Users/simulated";

  let platformDesc: PropertyDescriptor;
  let savedEnv: Record<string, string | undefined>;
  let homedirSpy: Mock<typeof os.homedir>;
  let spawnSpy: Mock<typeof Bun.spawn>;

  beforeEach(() => {
    platformDesc = Object.getOwnPropertyDescriptor(process, "platform")!;
    savedEnv = {
      APPDATA: process.env.APPDATA,
      WSL_DISTRO_NAME: process.env.WSL_DISTRO_NAME,
      WSL_INTEROP: process.env.WSL_INTEROP,
    };
    homedirSpy = spyOn(os, "homedir").mockReturnValue(HOME);
    spawnSpy = spyOn(Bun, "spawn");
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", platformDesc);
    spawnSpy.mockRestore();
    homedirSpy.mockRestore();
    restoreEnvAll(savedEnv);
    _resetAllCaches();
  });

  /**
   * Stub `cmd.exe` and `wslpath`, the two subprocesses
   * `getWindowsHomeDirFromWSL()` shells out to. `resolvable: false` makes the
   * first one fail, which is the "Windows home not resolvable" fall-through.
   */
  function stubWslSubprocesses(resolvable: boolean): void {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    spawnSpy.mockImplementation(((cmd: string[]) => {
      if (cmd[0] === "wslpath") {
        return {
          stdout: WIN_HOME + "\n",
          stderr: "",
          exited: Promise.resolve(0),
        };
      }
      return {
        stdout: resolvable ? "C:\\Users\\simulated\r\n" : "",
        stderr: "",
        exited: Promise.resolve(resolvable ? 0 : 1),
      };
    }) as unknown as typeof Bun.spawn);
  }

  // [label, simulated platform, APPDATA, WSL_DISTRO_NAME, Windows home
  //  resolvable, expected path with "/" separators]
  const cases = [
    [
      "win32 with APPDATA set",
      "win32",
      APP_DATA,
      null,
      false,
      `${APP_DATA}/Code/User/settings.json`,
    ],
    [
      "win32 with APPDATA unset",
      "win32",
      null,
      null,
      false,
      `${HOME}/AppData/Roaming/Code/User/settings.json`,
    ],
    [
      "macOS",
      "darwin",
      null,
      null,
      false,
      `${HOME}/Library/Application Support/Code/User/settings.json`,
    ],
    [
      "WSL with a resolvable Windows home",
      "linux",
      null,
      "Ubuntu-22.04",
      true,
      `${WIN_HOME}/AppData/Roaming/Code/User/settings.json`,
    ],
    [
      "WSL without a resolvable Windows home",
      "linux",
      null,
      "Ubuntu-22.04",
      false,
      `${HOME}/.config/Code/User/settings.json`,
    ],
    [
      "plain Linux",
      "linux",
      null,
      null,
      false,
      `${HOME}/.config/Code/User/settings.json`,
    ],
  ] as const;

  test.each(cases)(
    "resolves the settings path on %s",
    async (_label, platform, appData, wslDistro, resolvable, expected) => {
      Object.defineProperty(process, "platform", {
        ...platformDesc,
        value: platform,
      });
      delete process.env.WSL_INTEROP;
      if (appData === null) delete process.env.APPDATA;
      else process.env.APPDATA = appData;
      if (wslDistro === null) delete process.env.WSL_DISTRO_NAME;
      else process.env.WSL_DISTRO_NAME = wslDistro;
      stubWslSubprocesses(resolvable);
      _resetAllCaches();

      const path = await getVscodeUserSettingsPath();

      expect(path.replaceAll("\\", "/")).toBe(expected);
    }
  );
});
