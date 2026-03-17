import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerCursorSessionContextCommand } from "../../../src/commands/session-context/cursor";

describe("registerCursorSessionContextCommand", () => {
  test("registers 'cursor' as a subcommand", () => {
    const parent = new Command("session-context");
    registerCursorSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "cursor");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const parent = new Command("session-context");
    registerCursorSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "cursor")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --max-entries option", () => {
    const parent = new Command("session-context");
    registerCursorSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "cursor")!;
    const opt = sub.options.find((o) => o.long === "--max-entries");
    expect(opt).toBeDefined();
  });

  test("accepts --session-id option", () => {
    const parent = new Command("session-context");
    registerCursorSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "cursor")!;
    const opt = sub.options.find((o) => o.long === "--session-id");
    expect(opt).toBeDefined();
  });
});
