import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerAdrUpdateCommand } from "../../../src/commands/adr/update";

const ADR_CONTENT = `---
id: ARCH-001
title: Use TypeScript
domain: architecture
rules: false
---

## Context
We need a type-safe language.
`;

describe("registerAdrUpdateCommand", () => {
  test("registers 'update' as a subcommand", () => {
    const parent = new Command("adr");
    registerAdrUpdateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "update");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const parent = new Command("adr");
    registerAdrUpdateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "update")!;
    expect(sub.description()).toBeTruthy();
  });

  test("requires --id option", () => {
    const parent = new Command("adr");
    registerAdrUpdateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "update")!;
    const idOpt = sub.options.find((o) => o.long === "--id");
    expect(idOpt).toBeDefined();
    expect(idOpt!.required).toBe(true);
  });

  test("requires --body option", () => {
    const parent = new Command("adr");
    registerAdrUpdateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "update")!;
    const bodyOpt = sub.options.find((o) => o.long === "--body");
    expect(bodyOpt).toBeDefined();
    expect(bodyOpt!.required).toBe(true);
  });

  test("accepts --title option", () => {
    const parent = new Command("adr");
    registerAdrUpdateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "update")!;
    const titleOpt = sub.options.find((o) => o.long === "--title");
    expect(titleOpt).toBeDefined();
  });

  test("accepts --domain option", () => {
    const parent = new Command("adr");
    registerAdrUpdateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "update")!;
    const domainOpt = sub.options.find((o) => o.long === "--domain");
    expect(domainOpt).toBeDefined();
  });

  test("accepts --json option", () => {
    const parent = new Command("adr");
    registerAdrUpdateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "update")!;
    const jsonOpt = sub.options.find((o) => o.long === "--json");
    expect(jsonOpt).toBeDefined();
  });
});

describe("adr update action handler", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-update-test-"));
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
    registerAdrUpdateCommand(parent);
    return parent;
  }

  test("updates ADR body with --id and --body", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(adrsDir, "ARCH-001-use-typescript.md"), ADR_CONTENT);

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync([
      "node",
      "adr",
      "update",
      "--id",
      "ARCH-001",
      "--body",
      "## Context\nUpdated context.",
    ]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("Updated ADR:");
    expect(allOutput).toContain("ARCH-001");

    const updatedContent = await Bun.file(
      join(adrsDir, "ARCH-001-use-typescript.md")
    ).text();
    expect(updatedContent).toContain("Updated context.");
  });

  test("outputs JSON when --json flag is passed", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(adrsDir, "ARCH-001-use-typescript.md"), ADR_CONTENT);

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync([
      "node",
      "adr",
      "update",
      "--id",
      "ARCH-001",
      "--body",
      "## Context\nNew body.",
      "--json",
    ]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    const parsed = JSON.parse(allOutput);
    expect(parsed.id).toBe("ARCH-001");
    expect(parsed.fileName).toContain("ARCH-001");
    expect(parsed.filePath).toBeTruthy();
  });

  test("preserves existing title and domain when not specified", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(adrsDir, "ARCH-001-use-typescript.md"), ADR_CONTENT);

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync([
      "node",
      "adr",
      "update",
      "--id",
      "ARCH-001",
      "--body",
      "## Context\nReplaced body.",
    ]);

    const updatedContent = await Bun.file(
      join(adrsDir, "ARCH-001-use-typescript.md")
    ).text();
    expect(updatedContent).toContain("title: Use TypeScript");
    expect(updatedContent).toContain("domain: architecture");
  });

  test("exits with error when ADR ID is not found", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(adrsDir, "ARCH-001-use-typescript.md"), ADR_CONTENT);

    process.chdir(tempDir);
    const parent = makeProgram();

    await expect(
      parent.parseAsync([
        "node",
        "adr",
        "update",
        "--id",
        "ARCH-999",
        "--body",
        "## Context\nSomething.",
      ])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("exits with error when .archgate/ directory is missing", async () => {
    process.chdir(tempDir);
    const parent = makeProgram();

    await expect(
      parent.parseAsync([
        "node",
        "adr",
        "update",
        "--id",
        "ARCH-001",
        "--body",
        "## Context\nSomething.",
      ])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
