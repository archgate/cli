import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerCopilotSessionContextCommand } from "../../../src/commands/session-context/copilot";

describe("registerCopilotSessionContextCommand", () => {
  test("registers 'copilot' as a subcommand", () => {
    const parent = new Command("session-context");
    registerCopilotSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "copilot");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const parent = new Command("session-context");
    registerCopilotSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "copilot")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --max-entries option", () => {
    const parent = new Command("session-context");
    registerCopilotSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "copilot")!;
    const opt = sub.options.find((o) => o.long === "--max-entries");
    expect(opt).toBeDefined();
  });

  test("accepts --session-id option", () => {
    const parent = new Command("session-context");
    registerCopilotSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "copilot")!;
    const opt = sub.options.find((o) => o.long === "--session-id");
    expect(opt).toBeDefined();
  });
});
