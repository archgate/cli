// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// Sibling of vscode-settings.test.ts, split out to stay under the 500-line
// lint cap. Covers the Microsoft Store install, where Windows redirects a file
// the app creates under %APPDATA% into package-private storage.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import * as installInfo from "../../src/helpers/install-info";
import * as log from "../../src/helpers/log";
import {
  VscodeSettingsSchema,
  addMarketplaceToUserSettings,
  getVscodeUserSettingsPath,
} from "../../src/helpers/vscode-settings";
import { restoreEnv } from "../test-utils";

const URL = "https://user:token@plugins.archgate.dev/archgate.git";

describe("addMarketplaceToUserSettings from a Microsoft Store install", () => {
  let tempDir: string;
  let savedAppData: string | undefined;
  let homedirSpy: Mock<typeof os.homedir>;
  let methodSpy: Mock<typeof installInfo.detectInstallMethod>;
  let warnSpy: Mock<typeof log.logWarn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(os.tmpdir(), "archgate-msstore-settings-"));
    savedAppData = Bun.env.APPDATA;
    Bun.env.APPDATA = tempDir;
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempDir);
    methodSpy = spyOn(installInfo, "detectInstallMethod").mockReturnValue(
      "msstore"
    );
    warnSpy = spyOn(log, "logWarn").mockImplementation(() => {});
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    methodSpy.mockRestore();
    warnSpy.mockRestore();
    restoreEnv("APPDATA", savedAppData);
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("does not create a missing settings file and says what to add", async () => {
    expect(await addMarketplaceToUserSettings(URL)).toBeNull();

    expect(existsSync(await getVscodeUserSettingsPath())).toBe(false);
    expect(warnSpy.mock.calls.flat().join(" ")).toContain(
      "chat.plugins.marketplaces"
    );
  });

  test("edits an existing settings file in place", async () => {
    const path = await getVscodeUserSettingsPath();
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, '{ "editor.tabSize": 2 }');

    expect(await addMarketplaceToUserSettings(URL)).toBe(path);

    const content = VscodeSettingsSchema.parse(
      JSON.parse(await Bun.file(path).text())
    );
    expect(content["chat.plugins.marketplaces"]).toContain(URL);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
