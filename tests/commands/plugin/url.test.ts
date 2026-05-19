// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  spyOn,
  mock,
} from "bun:test";

import { Command } from "@commander-js/extra-typings";

// ---------------------------------------------------------------------------
// Module mocks — declared before imports that use them (ARCH-005).
// ---------------------------------------------------------------------------

// Mock editor-detect so non-TTY auto-detect paths don't require real editor
// binaries on disk.
mock.module("../../src/helpers/editor-detect", () => ({
  detectEditors: mock(() => Promise.resolve([])),
  promptSingleEditorSelection: mock(() => Promise.resolve("claude")),
}));

// ---------------------------------------------------------------------------
// Imports under test — loaded AFTER mocks are registered.
// ---------------------------------------------------------------------------

import { registerPluginUrlCommand } from "../../../src/commands/plugin/url";
import {
  buildCursorMarketplaceUrl,
  buildMarketplaceUrl,
  buildVscodeMarketplaceUrl,
} from "../../../src/helpers/plugin-install";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerPluginUrlCommand", () => {
  test("registers 'url' as a subcommand", () => {
    const program = new Command();
    registerPluginUrlCommand(program);
    const sub = program.commands.find((c) => c.name() === "url");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerPluginUrlCommand(program);
    const sub = program.commands.find((c) => c.name() === "url")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --editor option without default (auto-detect when omitted)", () => {
    const program = new Command();
    registerPluginUrlCommand(program);
    const sub = program.commands.find((c) => c.name() === "url")!;
    const editorOpt = sub.options.find((o) => o.long === "--editor");
    expect(editorOpt).toBeDefined();
    expect(editorOpt!.defaultValue).toBeUndefined();
  });

  test("--editor option restricts choices to valid editors", () => {
    const program = new Command();
    registerPluginUrlCommand(program);
    const sub = program.commands.find((c) => c.name() === "url")!;
    const editorOpt = sub.options.find((o) => o.long === "--editor")!;
    expect(editorOpt.argChoices).toEqual([
      "claude",
      "cursor",
      "vscode",
      "copilot",
      "opencode",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Action handler
// ---------------------------------------------------------------------------

describe("plugin url action handler", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function makeProgram(): Command {
    const program = new Command().exitOverride();
    registerPluginUrlCommand(program);
    return program;
  }

  test("--editor claude prints the Claude marketplace URL", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "test", "url", "--editor", "claude"]);

    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(output).toBe(buildMarketplaceUrl());
  });

  test("--editor cursor prints the Cursor marketplace URL", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "test", "url", "--editor", "cursor"]);

    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(output).toBe(buildCursorMarketplaceUrl());
  });

  test("--editor vscode prints the VS Code marketplace URL", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "test", "url", "--editor", "vscode"]);

    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(output).toBe(buildVscodeMarketplaceUrl());
  });

  test("--editor copilot prints the Claude marketplace URL (default)", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "test", "url", "--editor", "copilot"]);

    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(output).toBe(buildMarketplaceUrl());
  });

  test("--editor opencode prints authenticated install message", async () => {
    const program = makeProgram();
    await program.parseAsync(["node", "test", "url", "--editor", "opencode"]);

    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(output).toContain("archgate plugin install --editor opencode");
    expect(output).toContain("N/A");
  });

  test("non-TTY without --editor defaults to Claude URL", async () => {
    // In test environment, process.stdin.isTTY is typically falsy (non-TTY),
    // so the action falls through to the default "claude" editor.
    const originalIsTTY = process.stdin.isTTY;
    try {
      Object.defineProperty(process.stdin, "isTTY", {
        value: false,
        configurable: true,
      });

      const program = makeProgram();
      await program.parseAsync(["node", "test", "url"]);

      const output = logSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join("\n");
      expect(output).toBe(buildMarketplaceUrl());
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });
});
