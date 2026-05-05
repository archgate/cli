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

  test("claude-code subcommand has --max-entries option", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    const sub = parent.commands.find((c) => c.name() === "claude-code")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--max-entries");
  });

  test("cursor subcommand has --max-entries and --session-id options", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    const sub = parent.commands.find((c) => c.name() === "cursor")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--max-entries");
    expect(opts).toContain("--session-id");
  });

  test("copilot subcommand has --max-entries and --session-id options", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    const sub = parent.commands.find((c) => c.name() === "copilot")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--max-entries");
    expect(opts).toContain("--session-id");
  });

  test("opencode subcommand has --max-entries and --session-id options", () => {
    const program = new Command();
    registerSessionContextCommand(program);
    const parent = program.commands.find(
      (c) => c.name() === "session-context"
    )!;
    const sub = parent.commands.find((c) => c.name() === "opencode")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--max-entries");
    expect(opts).toContain("--session-id");
  });
});
