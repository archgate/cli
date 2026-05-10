// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ARCHGATE_CLAUDE_SETTINGS,
  mergeClaudeSettings,
  configureClaudeSettings,
} from "../../src/helpers/claude-settings";

describe("mergeClaudeSettings", () => {
  test("sets all archgate values when existing settings are empty", () => {
    const result = mergeClaudeSettings({}, ARCHGATE_CLAUDE_SETTINGS);

    expect(result.agent).toBe("archgate:developer");
    expect(result.permissions).toEqual({
      allow: [
        "Skill(archgate:architect)",
        "Skill(archgate:quality-manager)",
        "Skill(archgate:adr-author)",
      ],
    });
  });

  test("preserves existing agent (does not overwrite)", () => {
    const result = mergeClaudeSettings(
      { agent: "custom-agent" },
      ARCHGATE_CLAUDE_SETTINGS
    );

    expect(result.agent).toBe("custom-agent");
  });

  test("appends permissions.allow with dedup", () => {
    const result = mergeClaudeSettings(
      { permissions: { allow: ["Bash(git *)", "Skill(archgate:architect)"] } },
      ARCHGATE_CLAUDE_SETTINGS
    );

    const permissions = result.permissions as Record<string, unknown>;
    expect(permissions.allow).toEqual([
      "Bash(git *)",
      "Skill(archgate:architect)",
      "Skill(archgate:quality-manager)",
      "Skill(archgate:adr-author)",
    ]);
  });

  test("preserves existing deny permissions", () => {
    const result = mergeClaudeSettings(
      { permissions: { allow: ["Bash(ls)"], deny: ["Bash(rm -rf *)"] } },
      ARCHGATE_CLAUDE_SETTINGS
    );

    const permissions = result.permissions as Record<string, unknown>;
    expect(permissions.deny).toEqual(["Bash(rm -rf *)"]);
    expect(Array.isArray(permissions.allow)).toBe(true);
  });

  test("preserves unknown top-level keys", () => {
    const result = mergeClaudeSettings(
      { customSetting: "value", anotherKey: 42 },
      ARCHGATE_CLAUDE_SETTINGS
    );

    expect(result.customSetting).toBe("value");
    expect(result.anotherKey).toBe(42);
  });

  test("handles non-object permissions gracefully", () => {
    const result = mergeClaudeSettings(
      { permissions: "invalid" },
      ARCHGATE_CLAUDE_SETTINGS
    );

    const permissions = result.permissions as Record<string, unknown>;
    expect(permissions.allow).toEqual(
      ARCHGATE_CLAUDE_SETTINGS.permissions.allow
    );
  });
});

describe("configureClaudeSettings", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-claude-settings-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates .claude/ dir and settings file when neither exists", async () => {
    const settingsPath = await configureClaudeSettings(tempDir);

    expect(existsSync(join(tempDir, ".claude"))).toBe(true);
    expect(existsSync(settingsPath)).toBe(true);

    const content = JSON.parse(await Bun.file(settingsPath).text());
    expect(content.agent).toBe("archgate:developer");
    expect(content.permissions.allow).toContain("Skill(archgate:architect)");
  });

  test("merges into existing file without overwriting user entries", async () => {
    const claudeDir = join(tempDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });

    const existingSettings = {
      agent: "my-custom-agent",
      myCustomKey: true,
      permissions: { allow: ["Bash(git *)"], deny: ["Bash(rm *)"] },
    };
    await Bun.write(
      join(claudeDir, "settings.local.json"),
      JSON.stringify(existingSettings, null, 2)
    );

    await configureClaudeSettings(tempDir);

    const content = JSON.parse(
      await Bun.file(join(claudeDir, "settings.local.json")).text()
    );
    // Existing agent preserved
    expect(content.agent).toBe("my-custom-agent");
    // Custom key preserved
    expect(content.myCustomKey).toBe(true);
    // Deny permissions preserved
    expect(content.permissions.deny).toEqual(["Bash(rm *)"]);
    // Allow permissions appended
    expect(content.permissions.allow).toContain("Bash(git *)");
    expect(content.permissions.allow).toContain("Skill(archgate:architect)");
  });

  test("returns correct absolute path", async () => {
    const settingsPath = await configureClaudeSettings(tempDir);

    expect(settingsPath).toBe(join(tempDir, ".claude", "settings.local.json"));
  });
});
