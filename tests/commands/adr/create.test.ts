// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerAdrCreateCommand } from "../../../src/commands/adr/create";

describe("registerAdrCreateCommand", () => {
  test("registers 'create' as a subcommand", () => {
    const parent = new Command("adr");
    registerAdrCreateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "create");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const parent = new Command("adr");
    registerAdrCreateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "create")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --title option", () => {
    const parent = new Command("adr");
    registerAdrCreateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "create")!;
    const titleOpt = sub.options.find((o) => o.long === "--title");
    expect(titleOpt).toBeDefined();
  });

  test("accepts --domain option", () => {
    const parent = new Command("adr");
    registerAdrCreateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "create")!;
    const domainOpt = sub.options.find((o) => o.long === "--domain");
    expect(domainOpt).toBeDefined();
  });
});

describe("adr create action handler", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-create-test-"));
    originalCwd = process.cwd();
    // Prevent findProjectRoot() from walking above the temp dir
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete Bun.env.ARCHGATE_PROJECT_CEILING;
    rmSync(tempDir, { recursive: true, force: true });
    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  function makeProgram(): Command {
    const parent = new Command("adr").exitOverride();
    registerAdrCreateCommand(parent);
    return parent;
  }

  test("creates ADR non-interactively with --title and --domain", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync([
      "node",
      "adr",
      "create",
      "--title",
      "Use PostgreSQL",
      "--domain",
      "backend",
    ]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("Created ADR:");
    expect(allOutput).toContain("BE-001");
  });

  test("creates ADR and outputs file on disk", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync([
      "node",
      "adr",
      "create",
      "--title",
      "Use Redis",
      "--domain",
      "backend",
    ]);

    const createdFile = join(adrsDir, "BE-001-use-redis.md");
    expect(existsSync(createdFile)).toBe(true);
  });

  test("outputs JSON when --json flag is passed", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync([
      "node",
      "adr",
      "create",
      "--title",
      "Use Kafka",
      "--domain",
      "data",
      "--json",
    ]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    const parsed = JSON.parse(allOutput);
    expect(parsed.id).toBe("DATA-001");
    expect(parsed.fileName).toContain("DATA-001");
    expect(parsed.filePath).toBeTruthy();
  });

  test("creates ADR with custom body via --body option", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync([
      "node",
      "adr",
      "create",
      "--title",
      "Use GraphQL",
      "--domain",
      "frontend",
      "--body",
      "## Context\nWe need a flexible API.",
    ]);

    const createdFile = join(adrsDir, "FE-001-use-graphql.md");
    expect(existsSync(createdFile)).toBe(true);
    const content = await Bun.file(createdFile).text();
    expect(content).toContain("We need a flexible API.");
  });

  test("exits with error when .archgate/ directory is missing", async () => {
    process.chdir(tempDir);
    const parent = makeProgram();

    await expect(
      parent.parseAsync([
        "node",
        "adr",
        "create",
        "--title",
        "Test",
        "--domain",
        "general",
      ])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("parses comma-separated --files patterns into frontmatter", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync([
      "node",
      "adr",
      "create",
      "--title",
      "Scoped Rule",
      "--domain",
      "architecture",
      "--files",
      "src/**/*.ts, tests/**/*.ts",
      "--body",
      "## Context\nScoped to specific files.",
    ]);

    const createdFile = join(adrsDir, "ARCH-001-scoped-rule.md");
    expect(existsSync(createdFile)).toBe(true);
    const content = await Bun.file(createdFile).text();
    expect(content).toContain("src/**/*.ts");
    expect(content).toContain("tests/**/*.ts");
  });

  test("sets rules: true in frontmatter when --rules flag is passed", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync([
      "node",
      "adr",
      "create",
      "--title",
      "Enforced Rule",
      "--domain",
      "general",
      "--rules",
      "--body",
      "## Context\nThis ADR has rules.",
    ]);

    const createdFile = join(adrsDir, "GEN-001-enforced-rule.md");
    expect(existsSync(createdFile)).toBe(true);
    const content = await Bun.file(createdFile).text();
    expect(content).toContain("rules: true");
  });

  test("generates companion .rules.ts file when --rules flag is passed", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync([
      "node",
      "adr",
      "create",
      "--title",
      "With Rules",
      "--domain",
      "backend",
      "--rules",
      "--body",
      "## Context\nHas companion rules.",
    ]);

    const rulesFile = join(adrsDir, "BE-001-with-rules.rules.ts");
    expect(existsSync(rulesFile)).toBe(true);
  });

  test("does not generate .rules.ts file when --rules is omitted", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync([
      "node",
      "adr",
      "create",
      "--title",
      "No Rules",
      "--domain",
      "backend",
      "--body",
      "## Context\nNo rules needed.",
    ]);

    const rulesFile = join(adrsDir, "BE-001-no-rules.rules.ts");
    expect(existsSync(rulesFile)).toBe(false);
  });

  test("increments ADR ID when existing ADRs are present", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });

    // Create a first ADR
    process.chdir(tempDir);
    const parent1 = makeProgram();
    await parent1.parseAsync([
      "node",
      "adr",
      "create",
      "--title",
      "First ADR",
      "--domain",
      "backend",
    ]);

    // Create a second ADR in the same domain
    const parent2 = makeProgram();
    await parent2.parseAsync([
      "node",
      "adr",
      "create",
      "--title",
      "Second ADR",
      "--domain",
      "backend",
    ]);

    expect(existsSync(join(adrsDir, "BE-001-first-adr.md"))).toBe(true);
    expect(existsSync(join(adrsDir, "BE-002-second-adr.md"))).toBe(true);
  });
});
