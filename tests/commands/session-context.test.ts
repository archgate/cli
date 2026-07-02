// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerSessionContextCommand } from "../../src/commands/session-context/index";

describe("registerSessionContextCommand", () => {
  test("registers 'session-context' as a subcommand", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const sub = program.commands.find((c) => c.name() === "session-context");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const sub = program.commands.find((c) => c.name() === "session-context")!;
    expect(sub.description()).toBeTruthy();
  });

  test("registers 'claude-code' subcommand", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    const sub = parent.commands.find((c) => c.name() === "claude-code");
    expect(sub).toBeDefined();
  });

  test("registers 'copilot' subcommand", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    const sub = parent.commands.find((c) => c.name() === "copilot");
    expect(sub).toBeDefined();
  });

  test("registers 'cursor' subcommand", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    const sub = parent.commands.find((c) => c.name() === "cursor");
    expect(sub).toBeDefined();
  });

  test("registers 'opencode' subcommand", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    const sub = parent.commands.find((c) => c.name() === "opencode");
    expect(sub).toBeDefined();
  });

  test("claude-code subcommand has only --max-entries (read current conversation)", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    const sub = parent.commands.find((c) => c.name() === "claude-code")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--max-entries");
    expect(opts).not.toContain("--session-id");
    expect(opts).not.toContain("--list");
    expect(opts).not.toContain("--skip");
  });

  test("cursor subcommand has only --max-entries (read current conversation)", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    const sub = parent.commands.find((c) => c.name() === "cursor")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--max-entries");
    expect(opts).not.toContain("--session-id");
    expect(opts).not.toContain("--list");
    expect(opts).not.toContain("--skip");
  });

  test("copilot subcommand has only --max-entries (read current conversation)", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    const sub = parent.commands.find((c) => c.name() === "copilot")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--max-entries");
    expect(opts).not.toContain("--session-id");
    expect(opts).not.toContain("--list");
    expect(opts).not.toContain("--skip");
  });

  test("each editor subcommand has list and show children", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    // list/show are NOT direct children of session-context
    expect(parent.commands.map((c) => c.name())).toEqual([
      "claude-code",
      "copilot",
      "cursor",
      "opencode",
    ]);
    for (const editor of ["claude-code", "copilot", "cursor", "opencode"]) {
      const sub = parent.commands.find((c) => c.name() === editor)!;
      const children = sub.commands.map((c) => c.name()).sort();
      expect(children).toEqual(["list", "show"]);
    }
  });

  test("only opencode show has --root", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    for (const editor of ["claude-code", "copilot", "cursor", "opencode"]) {
      const sub = parent.commands.find((c) => c.name() === editor)!;
      const show = sub.commands.find((c) => c.name() === "show")!;
      const opts = show.options.map((o) => o.long);
      expect(opts).toContain("--max-entries");
      if (editor === "opencode") {
        expect(opts).toContain("--root");
      } else {
        expect(opts).not.toContain("--root");
      }
    }
  });

  test("opencode subcommand has only --max-entries (read current conversation)", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    const sub = parent.commands.find((c) => c.name() === "opencode")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--max-entries");
    expect(opts).not.toContain("--session-id");
    expect(opts).not.toContain("--root");
    expect(opts).not.toContain("--list");
    expect(opts).not.toContain("--skip");
  });
});
