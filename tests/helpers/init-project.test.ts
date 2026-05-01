import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initProject } from "../../src/helpers/init-project";

describe("initProject", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-initproj-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
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
    expect(existsSync(join(tempDir, ".cursor", "mcp.json"))).toBe(false);

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
    // MCP settings should not be present (MCP removed)
    expect(content.enabledMcpjsonServers).toBeUndefined();
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
});
