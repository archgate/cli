import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { safeRmSync } from "../test-utils";
import { runCli, createTempProject } from "./cli-harness";

let tempDir: string;
let fakeHome: string;

/** Env overrides to isolate from real ~/.archgate/ state */
function isolatedEnv(): Record<string, string> {
  return { HOME: fakeHome, USERPROFILE: fakeHome };
}

beforeEach(() => {
  tempDir = createTempProject("archgate-init-integ-");
  fakeHome = createTempProject("archgate-init-home-");
});

afterEach(() => {
  safeRmSync(tempDir);
  safeRmSync(fakeHome);
});

describe("init integration", () => {
  test("basic init creates .archgate structure", async () => {
    const result = await runCli(
      ["init", "--editor", "claude"],
      tempDir,
      isolatedEnv()
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Initialized Archgate governance");

    expect(existsSync(join(tempDir, ".archgate", "adrs"))).toBe(true);
    expect(existsSync(join(tempDir, ".archgate", "lint"))).toBe(true);
    expect(existsSync(join(tempDir, ".archgate", "lint", "README.md"))).toBe(
      true
    );

    const adrsDir = join(tempDir, ".archgate", "adrs");
    const adrFiles = readdirSync(adrsDir).filter(
      (f) => f.startsWith("GEN-001-") && f.endsWith(".md")
    );
    expect(adrFiles.length).toBeGreaterThan(0);

    expect(existsSync(join(tempDir, ".archgate", "rules.d.ts"))).toBe(true);
    expect(existsSync(join(tempDir, ".claude", "settings.local.json"))).toBe(
      true
    );
  });

  test("init with --editor cursor creates cursor rules directory and file", async () => {
    const result = await runCli(
      ["init", "--editor", "cursor"],
      tempDir,
      isolatedEnv()
    );

    expect(result.exitCode).toBe(0);

    expect(existsSync(join(tempDir, ".cursor", "rules"))).toBe(true);
    expect(
      existsSync(join(tempDir, ".cursor", "rules", "archgate-governance.mdc"))
    ).toBe(true);
  });

  test("init with --editor copilot creates copilot directory", async () => {
    const result = await runCli(
      ["init", "--editor", "copilot"],
      tempDir,
      isolatedEnv()
    );

    expect(result.exitCode).toBe(0);

    expect(existsSync(join(tempDir, ".github", "copilot"))).toBe(true);
  });

  test("init is idempotent — second run succeeds and does not duplicate example ADR", async () => {
    await runCli(["init", "--editor", "claude"], tempDir, isolatedEnv());

    const adrsDir = join(tempDir, ".archgate", "adrs");
    const adrsBefore = readdirSync(adrsDir).filter((f) => f.endsWith(".md"));

    const result = await runCli(
      ["init", "--editor", "claude"],
      tempDir,
      isolatedEnv()
    );

    expect(result.exitCode).toBe(0);

    const adrsAfter = readdirSync(adrsDir).filter((f) => f.endsWith(".md"));
    expect(adrsAfter.length).toBe(adrsBefore.length);
  });

  test("init adds .gitignore entries containing rules.d.ts", async () => {
    const result = await runCli(
      ["init", "--editor", "claude"],
      tempDir,
      isolatedEnv()
    );

    expect(result.exitCode).toBe(0);

    const gitignorePath = join(tempDir, ".gitignore");
    expect(existsSync(gitignorePath)).toBe(true);

    const content = await Bun.file(gitignorePath).text();
    expect(content).toContain("rules.d.ts");
  });

  test("init does not regenerate example ADR when ADRs already exist", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(
      join(adrsDir, "CUSTOM-001-my-decision.md"),
      `---\nid: CUSTOM-001\ntitle: My Decision\ndomain: general\nrules: false\n---\n\n## Context\n\nCustom decision.\n`
    );

    const result = await runCli(
      ["init", "--editor", "claude"],
      tempDir,
      isolatedEnv()
    );

    expect(result.exitCode).toBe(0);

    const gen001Files = readdirSync(adrsDir).filter((f) =>
      f.startsWith("GEN-001-")
    );
    expect(gen001Files.length).toBe(0);
  });

  test("init adds oxlint override when .oxlintrc.json exists", async () => {
    const oxlintPath = join(tempDir, ".oxlintrc.json");
    writeFileSync(oxlintPath, "{}\n");

    const result = await runCli(
      ["init", "--editor", "claude"],
      tempDir,
      isolatedEnv()
    );

    expect(result.exitCode).toBe(0);

    const content = await Bun.file(oxlintPath).text();
    expect(content).toContain(".archgate/adrs/*.rules.ts");
  });
});
