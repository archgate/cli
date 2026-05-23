// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  configureOpencodeSettings,
  mergeOpencodeSettings,
  opencodeConfigPath,
} from "../../src/helpers/opencode-settings";

describe("mergeOpencodeSettings", () => {
  test("sets default_agent when existing config is empty", () => {
    const result = mergeOpencodeSettings({});

    expect(result.default_agent).toBe("archgate-developer");
  });

  test("preserves existing default_agent (does not overwrite)", () => {
    const result = mergeOpencodeSettings({ default_agent: "my-custom-agent" });

    expect(result.default_agent).toBe("my-custom-agent");
  });

  test("preserves unknown top-level keys", () => {
    const result = mergeOpencodeSettings({
      model: "anthropic/claude-sonnet-4-5",
      autoupdate: true,
    });

    expect(result.model).toBe("anthropic/claude-sonnet-4-5");
    expect(result.autoupdate).toBe(true);
    expect(result.default_agent).toBe("archgate-developer");
  });

  test("preserves existing nested config objects", () => {
    const result = mergeOpencodeSettings({
      server: { port: 4096 },
      tools: { write: false },
    });

    expect(result.server).toEqual({ port: 4096 });
    expect(result.tools).toEqual({ write: false });
    expect(result.default_agent).toBe("archgate-developer");
  });
});

describe("opencodeConfigPath", () => {
  let originalXdg: string | undefined;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalXdg = Bun.env.XDG_CONFIG_HOME;
    originalHome = Bun.env.HOME;
  });

  afterEach(() => {
    if (originalXdg === undefined) delete Bun.env.XDG_CONFIG_HOME;
    else Bun.env.XDG_CONFIG_HOME = originalXdg;
    if (originalHome === undefined) delete Bun.env.HOME;
    else Bun.env.HOME = originalHome;
  });

  test("resolves to XDG_CONFIG_HOME when set", () => {
    Bun.env.XDG_CONFIG_HOME = "/custom/xdg";

    const path = opencodeConfigPath();

    expect(path).toBe(join("/custom/xdg", "opencode", "opencode.json"));
  });
});

describe("configureOpencodeSettings", () => {
  let tempDir: string;
  let originalXdg: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-opencode-settings-test-"));
    originalXdg = Bun.env.XDG_CONFIG_HOME;
    Bun.env.XDG_CONFIG_HOME = tempDir;
  });

  afterEach(() => {
    if (originalXdg === undefined) delete Bun.env.XDG_CONFIG_HOME;
    else Bun.env.XDG_CONFIG_HOME = originalXdg;
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup may fail on Windows
    }
  });

  test("creates config file with default_agent when none exists", async () => {
    const configPath = await configureOpencodeSettings();

    expect(existsSync(configPath)).toBe(true);
    const content = await Bun.file(configPath).json();
    expect(content.default_agent).toBe("archgate-developer");
  });

  test("merges into existing file without overwriting user entries", async () => {
    const configDir = join(tempDir, "opencode");
    mkdirSync(configDir, { recursive: true });

    const existingConfig = {
      default_agent: "my-custom-agent",
      model: "anthropic/claude-sonnet-4-5",
    };
    await Bun.write(
      join(configDir, "opencode.json"),
      JSON.stringify(existingConfig, null, 2)
    );

    await configureOpencodeSettings();

    const content = await Bun.file(join(configDir, "opencode.json")).json();
    // Existing default_agent preserved
    expect(content.default_agent).toBe("my-custom-agent");
    // Existing model preserved
    expect(content.model).toBe("anthropic/claude-sonnet-4-5");
  });

  test("creates parent directories when missing", async () => {
    // XDG_CONFIG_HOME points to tempDir; opencode/ subdirectory does not exist
    const configPath = await configureOpencodeSettings();

    expect(existsSync(configPath)).toBe(true);
    expect(configPath).toContain("opencode.json");
  });

  test("returns correct absolute path", async () => {
    const configPath = await configureOpencodeSettings();

    expect(configPath).toBe(join(tempDir, "opencode", "opencode.json"));
  });
});
