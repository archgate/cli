import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerAdrListCommand } from "../../../src/commands/adr/list";

const ADR_CONTENT_1 = `---
id: ARCH-001
title: Use TypeScript
domain: architecture
rules: false
---

## Context
We need a type-safe language.
`;

const ADR_CONTENT_2 = `---
id: GEN-001
title: Use Conventional Commits
domain: general
rules: true
---

## Context
We need consistent commit messages.
`;

describe("registerAdrListCommand", () => {
  test("registers 'list' as a subcommand", () => {
    const parent = new Command("adr");
    registerAdrListCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "list");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const parent = new Command("adr");
    registerAdrListCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "list")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --json option", () => {
    const parent = new Command("adr");
    registerAdrListCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "list")!;
    const jsonOpt = sub.options.find((o) => o.long === "--json");
    expect(jsonOpt).toBeDefined();
  });

  test("accepts --domain option", () => {
    const parent = new Command("adr");
    registerAdrListCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "list")!;
    const domainOpt = sub.options.find((o) => o.long === "--domain");
    expect(domainOpt).toBeDefined();
  });
});

describe("adr list action handler", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-list-test-"));
    originalCwd = process.cwd();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  function makeProgram(): Command {
    const parent = new Command("adr").exitOverride();
    registerAdrListCommand(parent);
    return parent;
  }

  test("lists ADRs from .archgate/adrs/ directory in table format", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(adrsDir, "ARCH-001-use-typescript.md"), ADR_CONTENT_1);
    writeFileSync(
      join(adrsDir, "GEN-001-use-conventional-commits.md"),
      ADR_CONTENT_2
    );

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync(["node", "adr", "list"]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("ARCH-001");
    expect(allOutput).toContain("GEN-001");
  });

  test("outputs JSON when --json flag is passed", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(adrsDir, "ARCH-001-use-typescript.md"), ADR_CONTENT_1);

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync(["node", "adr", "list", "--json"]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    const parsed = JSON.parse(allOutput);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("ARCH-001");
    expect(parsed[0].domain).toBe("architecture");
  });

  test("filters by domain with --domain flag", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(adrsDir, "ARCH-001-use-typescript.md"), ADR_CONTENT_1);
    writeFileSync(
      join(adrsDir, "GEN-001-use-conventional-commits.md"),
      ADR_CONTENT_2
    );

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync([
      "node",
      "adr",
      "list",
      "--domain",
      "architecture",
    ]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("ARCH-001");
    expect(allOutput).not.toContain("GEN-001");
  });

  test("combines --domain and --json filters", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(adrsDir, "ARCH-001-use-typescript.md"), ADR_CONTENT_1);
    writeFileSync(
      join(adrsDir, "GEN-001-use-conventional-commits.md"),
      ADR_CONTENT_2
    );

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync([
      "node",
      "adr",
      "list",
      "--domain",
      "general",
      "--json",
    ]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    const parsed = JSON.parse(allOutput);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("GEN-001");
  });

  test("prints 'No ADRs found.' when adrs directory is empty", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync(["node", "adr", "list"]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("No ADRs found.");
  });

  test("prints 'No ADRs found.' when adrs directory is empty", async () => {
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync(["node", "adr", "list"]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("No ADRs found.");
  });

  test("exits with error when .archgate/ directory is missing", async () => {
    process.chdir(tempDir);
    const parent = makeProgram();

    await expect(parent.parseAsync(["node", "adr", "list"])).rejects.toThrow(
      "process.exit"
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
