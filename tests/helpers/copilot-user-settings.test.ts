// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  configureCopilotUserSettings,
  mergeCopilotPluginSettings,
} from "../../src/helpers/copilot-user-settings";
import { copilotConfigDir } from "../../src/helpers/paths";
import { restoreEnv } from "../test-utils";

const URL = "https://plugins.archgate.dev/archgate/vscode.git";

const ARCHGATE_ENTRY = { source: { source: "git", url: URL } };

describe("mergeCopilotPluginSettings", () => {
  test("adds marketplace and plugin entries to an empty object", () => {
    const merged = mergeCopilotPluginSettings({}, URL);

    expect(merged.extraKnownMarketplaces).toEqual({ archgate: ARCHGATE_ENTRY });
    expect(merged.enabledPlugins).toEqual({ "archgate@archgate": true });
  });

  test("preserves other marketplaces, plugins, and unrelated settings", () => {
    const merged = mergeCopilotPluginSettings(
      {
        extraKnownMarketplaces: {
          other: { source: { source: "github", repo: "acme/plugins" } },
        },
        enabledPlugins: { "foo@other": false },
        theme: "dark",
      },
      URL
    );

    expect(merged.extraKnownMarketplaces).toEqual({
      other: { source: { source: "github", repo: "acme/plugins" } },
      archgate: ARCHGATE_ENTRY,
    });
    expect(merged.enabledPlugins).toEqual({
      "foo@other": false,
      "archgate@archgate": true,
    });
    expect(merged.theme).toBe("dark");
  });

  test("overwrites an existing archgate marketplace entry (stale URL correction)", () => {
    const merged = mergeCopilotPluginSettings(
      {
        extraKnownMarketplaces: {
          archgate: {
            source: { source: "git", url: "https://example.com/dead.git" },
          },
        },
      },
      URL
    );

    expect(merged.extraKnownMarketplaces).toEqual({ archgate: ARCHGATE_ENTRY });
  });

  test("re-enables the plugin when it was explicitly disabled", () => {
    const merged = mergeCopilotPluginSettings(
      { enabledPlugins: { "archgate@archgate": false } },
      URL
    );

    expect(merged.enabledPlugins).toEqual({ "archgate@archgate": true });
  });
});

describe("configureCopilotUserSettings", () => {
  let tempHome: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    // Redirect ~/.copilot into a temp dir — copilotConfigDir() reads HOME
    // at call time, so tests never touch the developer's real settings.
    tempHome = mkdtempSync(join(tmpdir(), "archgate-copilot-settings-"));
    savedHome = Bun.env.HOME;
    Bun.env.HOME = tempHome;
    mkdirSync(copilotConfigDir(), { recursive: true });
  });

  afterEach(() => {
    restoreEnv("HOME", savedHome);
    rmSync(tempHome, { recursive: true, force: true });
  });

  async function readSettings(): Promise<Record<string, unknown>> {
    const raw: unknown = await Bun.file(
      join(copilotConfigDir(), "settings.json")
    ).json();
    // Test-only narrowing of a file this suite just wrote as a JSON object.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return raw as Record<string, unknown>;
  }

  test("creates the settings file when absent and returns its path", async () => {
    const path = await configureCopilotUserSettings(URL);

    expect(path).toBe(join(copilotConfigDir(), "settings.json"));
    const settings = await readSettings();
    expect(settings.extraKnownMarketplaces).toEqual({
      archgate: ARCHGATE_ENTRY,
    });
    expect(settings.enabledPlugins).toEqual({ "archgate@archgate": true });
  });

  test("writes a trailing newline", async () => {
    await configureCopilotUserSettings(URL);
    const content = await Bun.file(
      join(copilotConfigDir(), "settings.json")
    ).text();
    expect(content).toEndWith("\n");
  });

  test("accepts JSONC input (comments and trailing commas)", async () => {
    await Bun.write(
      join(copilotConfigDir(), "settings.json"),
      `{
  // user comment
  "theme": "dark",
  "enabledPlugins": { "foo@other": true, },
}`
    );

    await configureCopilotUserSettings(URL);

    const settings = await readSettings();
    expect(settings.theme).toBe("dark");
    expect(settings.enabledPlugins).toEqual({
      "foo@other": true,
      "archgate@archgate": true,
    });
  });

  test("replaces a malformed settings file instead of aborting", async () => {
    await Bun.write(join(copilotConfigDir(), "settings.json"), "{ not json !");

    await configureCopilotUserSettings(URL);

    const settings = await readSettings();
    expect(settings.extraKnownMarketplaces).toEqual({
      archgate: ARCHGATE_ENTRY,
    });
    expect(settings.enabledPlugins).toEqual({ "archgate@archgate": true });
  });
});
