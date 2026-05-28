// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as credentialStore from "../../src/helpers/credential-store";
import { initProject } from "../../src/helpers/init-project";
import * as pluginInstall from "../../src/helpers/plugin-install";
import { safeRmSync } from "../test-utils";

describe("initProject", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-initproj-test-"));
  });

  afterEach(() => {
    safeRmSync(tempDir);
  });

  test("creates .archgate/adrs/ directory structure", async () => {
    await initProject(tempDir);
    expect(existsSync(join(tempDir, ".archgate"))).toBe(true);
    expect(existsSync(join(tempDir, ".archgate", "adrs"))).toBe(true);
  });

  test("creates .archgate/lint/ directory with README", async () => {
    await initProject(tempDir);
    expect(existsSync(join(tempDir, ".archgate", "lint"))).toBe(true);
    const readmePath = join(tempDir, ".archgate", "lint", "README.md");
    expect(existsSync(readmePath)).toBe(true);
    const content = await Bun.file(readmePath).text();
    expect(content).toContain("Linter Rules");
    expect(content).toContain("oxlint");
  });

  test("creates an example ADR file", async () => {
    await initProject(tempDir);
    const examplePath = join(
      tempDir,
      ".archgate",
      "adrs",
      "GEN-001-example.md"
    );
    expect(existsSync(examplePath)).toBe(true);
  });

  test("returns correct result shape", async () => {
    const result = await initProject(tempDir);
    expect(result.projectRoot).toBe(tempDir);
    expect(result.adrsDir).toBe(join(tempDir, ".archgate", "adrs"));
    expect(result.lintDir).toBe(join(tempDir, ".archgate", "lint"));
  });

  test("is idempotent — succeeds when .archgate/ already exists", async () => {
    const first = await initProject(tempDir);
    const second = await initProject(tempDir);

    expect(second.projectRoot).toBe(first.projectRoot);
    expect(second.adrsDir).toBe(first.adrsDir);
    expect(second.lintDir).toBe(first.lintDir);

    // Directories and scaffolding files still exist after re-init
    expect(existsSync(join(tempDir, ".archgate", "lint", "README.md"))).toBe(
      true
    );
    expect(existsSync(join(tempDir, ".claude", "settings.local.json"))).toBe(
      true
    );
  });

  test("configures Cursor settings when editor is cursor (no project files)", async () => {
    const result = await initProject(tempDir, { editor: "cursor" });

    // Cursor plugin is embedded in the VSIX — no project-level files written
    expect(existsSync(join(tempDir, ".cursor"))).toBe(false);

    // Claude settings should NOT exist
    expect(existsSync(join(tempDir, ".claude", "settings.local.json"))).toBe(
      false
    );

    // Result should point to .cursor/ directory
    expect(result.editorSettingsPath).toBe(join(tempDir, ".cursor"));
  });

  test("skips example ADR when ADRs already exist", async () => {
    // Pre-create .archgate/adrs/ with an existing ADR
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    await Bun.write(
      join(adrsDir, "PROJ-001-existing.md"),
      "---\nid: PROJ-001\n---\n"
    );

    await initProject(tempDir);

    // Example ADR should NOT have been generated
    expect(existsSync(join(adrsDir, "GEN-001-example.md"))).toBe(false);
    // Existing ADR should be untouched
    expect(existsSync(join(adrsDir, "PROJ-001-existing.md"))).toBe(true);
  });

  test("creates .claude/settings.local.json", async () => {
    await initProject(tempDir);
    const settingsPath = join(tempDir, ".claude", "settings.local.json");
    expect(existsSync(settingsPath)).toBe(true);

    const content = JSON.parse(await Bun.file(settingsPath).text());
    expect(content.agent).toBe("archgate:developer");
  });

  test("includes editorSettingsPath in result", async () => {
    const result = await initProject(tempDir);
    expect(result.editorSettingsPath).toBe(
      join(tempDir, ".claude", "settings.local.json")
    );
  });

  test("generates rules.d.ts in .archgate/", async () => {
    await initProject(tempDir);

    const dtsPath = join(tempDir, ".archgate", "rules.d.ts");
    expect(existsSync(dtsPath)).toBe(true);

    const dtsContent = await Bun.file(dtsPath).text();
    expect(dtsContent).toContain("declare interface RuleContext");
  });

  test("adds rules.d.ts to .gitignore", async () => {
    await initProject(tempDir);

    const gitignorePath = join(tempDir, ".gitignore");
    expect(existsSync(gitignorePath)).toBe(true);

    const content = await Bun.file(gitignorePath).text();
    expect(content).toContain(".archgate/rules.d.ts");
  });

  test("does not duplicate .gitignore entries on re-init", async () => {
    await initProject(tempDir);
    await initProject(tempDir);

    const content = await Bun.file(join(tempDir, ".gitignore")).text();
    const dtsCount = content.split(".archgate/rules.d.ts").length - 1;
    expect(dtsCount).toBe(1);
  });

  test("adds oxlint override for triple-slash-reference", async () => {
    await Bun.write(join(tempDir, ".oxlintrc.json"), '{"rules":{}}');
    await initProject(tempDir);

    const config = await Bun.file(join(tempDir, ".oxlintrc.json")).json();
    expect(config.overrides).toHaveLength(1);
    expect(config.overrides[0].files).toEqual([".archgate/adrs/*.rules.ts"]);
    expect(config.overrides[0].rules["typescript/triple-slash-reference"]).toBe(
      "off"
    );
  });

  test("adds eslintrc override for triple-slash-reference", async () => {
    await Bun.write(join(tempDir, ".eslintrc.json"), '{"rules":{}}');
    await initProject(tempDir);

    const config = await Bun.file(join(tempDir, ".eslintrc.json")).json();
    expect(config.overrides).toHaveLength(1);
    expect(
      config.overrides[0].rules["@typescript-eslint/triple-slash-reference"]
    ).toBe("off");
  });

  test("does not duplicate linter overrides on re-init", async () => {
    await Bun.write(join(tempDir, ".oxlintrc.json"), "{}");
    await initProject(tempDir);
    await initProject(tempDir);

    const config = await Bun.file(join(tempDir, ".oxlintrc.json")).json();
    expect(config.overrides).toHaveLength(1);
  });

  test("configures Copilot settings when editor is copilot", async () => {
    const result = await initProject(tempDir, { editor: "copilot" });
    const copilotDir = join(tempDir, ".github", "copilot");
    expect(existsSync(copilotDir)).toBe(true);
    expect(result.editorSettingsPath).toBe(copilotDir);

    // Claude settings should NOT exist
    expect(existsSync(join(tempDir, ".claude", "settings.local.json"))).toBe(
      false
    );
  });

  test("configures opencode settings — returns user-scope agents dir", async () => {
    const savedHome = Bun.env.HOME;
    const savedXdg = Bun.env.XDG_CONFIG_HOME;
    try {
      Bun.env.HOME = tempDir;
      delete Bun.env.XDG_CONFIG_HOME;

      const result = await initProject(tempDir, { editor: "opencode" });
      const expectedDir = join(tempDir, ".config", "opencode", "agents");
      expect(result.editorSettingsPath).toBe(expectedDir);

      // Claude settings should NOT exist
      expect(existsSync(join(tempDir, ".claude", "settings.local.json"))).toBe(
        false
      );
    } finally {
      Bun.env.HOME = savedHome;
      if (savedXdg !== undefined) {
        Bun.env.XDG_CONFIG_HOME = savedXdg;
      }
    }
  });

  test("configures VS Code settings when editor is vscode", async () => {
    // The vscode branch in configureEditorSettings dynamically imports
    // credential-store. Spy on it (not mock.module, which leaks globally) to
    // avoid hitting the real credential store. spyOn reflects through the
    // dynamic import because it targets the same module instance.
    const credSpy = spyOn(credentialStore, "loadCredentials").mockResolvedValue(
      null
    );

    try {
      const result = await initProject(tempDir, { editor: "vscode" });
      const vscodeDir = join(tempDir, ".vscode");
      expect(result.editorSettingsPath).toBe(vscodeDir);

      // Claude settings should NOT exist
      expect(existsSync(join(tempDir, ".claude", "settings.local.json"))).toBe(
        false
      );
    } finally {
      credSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// tryInstallPlugin — exercises the plugin install path triggered by
// initProject(root, { installPlugin: true, editor: ... })
// ---------------------------------------------------------------------------

describe("tryInstallPlugin via initProject", () => {
  let tempDir: string;
  let credSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-initproj-plugin-"));
    credSpy = spyOn(credentialStore, "loadCredentials").mockResolvedValue(null);
  });

  afterEach(() => {
    credSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("no credentials returns installed: false", async () => {
    credSpy.mockResolvedValue(null);
    const result = await initProject(tempDir, { installPlugin: true });
    expect(result.plugin).toBeDefined();
    expect(result.plugin!.installed).toBe(false);
    expect(result.plugin!.detail).toContain("No stored credentials");
  });

  test("cursor returns marketplace URL", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const urlSpy = spyOn(
      pluginInstall,
      "buildCursorMarketplaceUrl"
    ).mockReturnValue("https://cursor.example");
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "cursor",
      });
      expect(result.plugin!.installed).toBe(true);
      expect(result.plugin!.detail).toBe("https://cursor.example");
    } finally {
      urlSpy.mockRestore();
    }
  });

  test("vscode returns auto-installed", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const result = await initProject(tempDir, {
      installPlugin: true,
      editor: "vscode",
    });
    expect(result.plugin!.installed).toBe(true);
    expect(result.plugin!.autoInstalled).toBe(true);
  });

  test("claude with CLI available auto-installs", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const cliSpy = spyOn(
      pluginInstall,
      "isClaudeCliAvailable"
    ).mockResolvedValue(true);
    const installSpy = spyOn(
      pluginInstall,
      "installClaudePlugin"
    ).mockResolvedValue();
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "claude",
      });
      expect(result.plugin!.installed).toBe(true);
      expect(result.plugin!.autoInstalled).toBe(true);
      expect(installSpy).toHaveBeenCalledTimes(1);
    } finally {
      cliSpy.mockRestore();
      installSpy.mockRestore();
    }
  });

  test("claude without CLI falls back to marketplace URL", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const cliSpy = spyOn(
      pluginInstall,
      "isClaudeCliAvailable"
    ).mockResolvedValue(false);
    const urlSpy = spyOn(pluginInstall, "buildMarketplaceUrl").mockReturnValue(
      "https://marketplace.example"
    );
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "claude",
      });
      expect(result.plugin!.installed).toBe(true);
      expect(result.plugin!.detail).toBe("https://marketplace.example");
      expect(result.plugin!.autoInstalled).toBeUndefined();
    } finally {
      cliSpy.mockRestore();
      urlSpy.mockRestore();
    }
  });

  test("claude install failure falls back to marketplace URL", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const cliSpy = spyOn(
      pluginInstall,
      "isClaudeCliAvailable"
    ).mockResolvedValue(true);
    const installSpy = spyOn(
      pluginInstall,
      "installClaudePlugin"
    ).mockRejectedValue(new Error("install failed"));
    const urlSpy = spyOn(pluginInstall, "buildMarketplaceUrl").mockReturnValue(
      "https://marketplace.example"
    );
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "claude",
      });
      expect(result.plugin!.installed).toBe(true);
      expect(result.plugin!.detail).toBe("https://marketplace.example");
    } finally {
      cliSpy.mockRestore();
      installSpy.mockRestore();
      urlSpy.mockRestore();
    }
  });

  test("copilot with CLI available auto-installs", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const cliSpy = spyOn(
      pluginInstall,
      "isCopilotCliAvailable"
    ).mockResolvedValue(true);
    const installSpy = spyOn(
      pluginInstall,
      "installCopilotPlugin"
    ).mockResolvedValue();
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "copilot",
      });
      expect(result.plugin!.installed).toBe(true);
      expect(result.plugin!.autoInstalled).toBe(true);
    } finally {
      cliSpy.mockRestore();
      installSpy.mockRestore();
    }
  });

  test("copilot without CLI falls back to marketplace URL", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const cliSpy = spyOn(
      pluginInstall,
      "isCopilotCliAvailable"
    ).mockResolvedValue(false);
    const urlSpy = spyOn(
      pluginInstall,
      "buildVscodeMarketplaceUrl"
    ).mockReturnValue("https://vscode.example");
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "copilot",
      });
      expect(result.plugin!.installed).toBe(true);
      expect(result.plugin!.detail).toBe("https://vscode.example");
    } finally {
      cliSpy.mockRestore();
      urlSpy.mockRestore();
    }
  });

  test("opencode with CLI available auto-installs", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const cliSpy = spyOn(
      pluginInstall,
      "isOpencodeCliAvailable"
    ).mockResolvedValue(true);
    const installSpy = spyOn(
      pluginInstall,
      "installOpencodePlugin"
    ).mockResolvedValue();
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "opencode",
      });
      expect(result.plugin!.installed).toBe(true);
      expect(result.plugin!.autoInstalled).toBe(true);
    } finally {
      cliSpy.mockRestore();
      installSpy.mockRestore();
    }
  });

  test("opencode without CLI returns cli-not-found", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const cliSpy = spyOn(
      pluginInstall,
      "isOpencodeCliAvailable"
    ).mockResolvedValue(false);
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "opencode",
      });
      expect(result.plugin!.installed).toBe(true);
      expect(result.plugin!.detail).toBe("cli-not-found");
    } finally {
      cliSpy.mockRestore();
    }
  });

  test("opencode install failure returns error detail", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const cliSpy = spyOn(
      pluginInstall,
      "isOpencodeCliAvailable"
    ).mockResolvedValue(true);
    const installSpy = spyOn(
      pluginInstall,
      "installOpencodePlugin"
    ).mockRejectedValue(new Error("network timeout"));
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "opencode",
      });
      expect(result.plugin!.installed).toBe(true);
      expect(result.plugin!.detail).toBe("network timeout");
    } finally {
      cliSpy.mockRestore();
      installSpy.mockRestore();
    }
  });
});
