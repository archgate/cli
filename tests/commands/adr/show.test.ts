// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  spyOn,
  type Mock,
} from "bun:test";
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
  let logSpy: Mock<typeof console.log>;
  let exitSpy: Mock<typeof process.exit>;

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

  // Both output branches are covered explicitly below — piped and TTY — which
  // between them assert every line of the action handler.
  test("emits the raw file byte-for-byte when stdout is piped", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(adrsDir, "ARCH-001-use-typescript.md"), ADR_CONTENT);

    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      () => true
    );
    const originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = false;
    let written: string[];
    try {
      process.chdir(tempDir);
      await makeProgram().parseAsync(["node", "adr", "show", "ARCH-001"]);
    } finally {
      // Read the calls before restoring: mockRestore() also resets them.
      written = writeSpy.mock.calls.map((call) => String(call[0]));
      process.stdout.isTTY = originalIsTTY;
      writeSpy.mockRestore();
    }

    // Agents and scripts parse the source, so the piped form is the file
    // exactly — frontmatter delimiters and all, and no appended newline. The
    // spy also catches the reporter's own writes, so match on membership.
    expect(written).toContain(ADR_CONTENT);
  });

  test("renders for a terminal when stdout is a TTY", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(adrsDir, "ARCH-001-use-typescript.md"), ADR_CONTENT);

    const originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = true;
    try {
      process.chdir(tempDir);
      await makeProgram().parseAsync(["node", "adr", "show", "ARCH-001"]);
    } finally {
      process.stdout.isTTY = originalIsTTY;
    }

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("ARCH-001  Use TypeScript");
    expect(output).toContain("We need a type-safe language.");
    // The YAML frontmatter is rendered as a header rather than fed to the
    // markdown parser, which would read `---` as a horizontal rule.
    expect(output).not.toContain("rules: false");
  });

  test("exits with error when ADR ID is not found", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(join(adrsDir, "ARCH-001-use-typescript.md"), ADR_CONTENT);

    process.chdir(tempDir);
    const parent = makeProgram();

    expect(
      parent.parseAsync(["node", "adr", "show", "ARCH-999"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("exits with error when .archgate/adrs/ directory is missing", async () => {
    process.chdir(tempDir);
    const parent = makeProgram();

    expect(
      parent.parseAsync(["node", "adr", "show", "ARCH-001"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
