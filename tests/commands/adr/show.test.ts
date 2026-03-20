import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerAdrShowCommand } from "../../../src/commands/adr/show";

const ADR_CONTENT = `---
id: ARCH-001
title: Use TypeScript
domain: architecture
rules: false
---

## Context
We need a type-safe language.
`;

describe("registerAdrShowCommand", () => {
  test("registers 'show' as a subcommand", () => {
    const parent = new Command("adr");
    registerAdrShowCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "show");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const parent = new Command("adr");
    registerAdrShowCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "show")!;
    expect(sub.description()).toBeTruthy();
  });

  test("requires an id argument", () => {
    const parent = new Command("adr");
    registerAdrShowCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "show")!;
    const args = sub.registeredArguments;
    expect(args.length).toBeGreaterThan(0);
    expect(args[0].required).toBe(true);
  });
});

describe("adr show action handler", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-show-test-"));
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
    registerAdrShowCommand(parent);
    return parent;
  }

  test("shows ADR content by ID", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(adrsDir, "ARCH-001-use-typescript.md"), ADR_CONTENT);

    process.chdir(tempDir);
    const parent = makeProgram();
    await parent.parseAsync(["node", "adr", "show", "ARCH-001"]);

    const allOutput = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("ARCH-001");
    expect(allOutput).toContain("Use TypeScript");
    expect(allOutput).toContain("We need a type-safe language.");
  });

  test("exits with error when ADR ID is not found", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(adrsDir, "ARCH-001-use-typescript.md"), ADR_CONTENT);

    process.chdir(tempDir);
    const parent = makeProgram();

    await expect(
      parent.parseAsync(["node", "adr", "show", "ARCH-999"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("exits with error when .archgate/adrs/ directory is missing", async () => {
    process.chdir(tempDir);
    const parent = makeProgram();

    await expect(
      parent.parseAsync(["node", "adr", "show", "ARCH-001"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
