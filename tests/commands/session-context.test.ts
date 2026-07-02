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

  test("registers 'show' subcommand with --editor and --root options", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    const sub = parent.commands.find((c) => c.name() === "show")!;
    expect(sub).toBeDefined();
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--editor");
    expect(opts).toContain("--max-entries");
    expect(opts).toContain("--root");
  });

  test("registers 'list' subcommand with --editor choices", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    const sub = parent.commands.find((c) => c.name() === "list")!;
    expect(sub).toBeDefined();
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--editor");
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
