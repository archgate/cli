import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerOpencodeSessionContextCommand } from "../../../src/commands/session-context/opencode";

describe("registerOpencodeSessionContextCommand", () => {
  test("registers 'opencode' as a subcommand", () => {
    const parent = new Command("session-context");
    registerOpencodeSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "opencode");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const parent = new Command("session-context");
    registerOpencodeSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "opencode")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --max-entries option", () => {
    const parent = new Command("session-context");
    registerOpencodeSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "opencode")!;
    const opt = sub.options.find((o) => o.long === "--max-entries");
    expect(opt).toBeDefined();
  });

  test("accepts --session-id option", () => {
    const parent = new Command("session-context");
    registerOpencodeSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "opencode")!;
    const opt = sub.options.find((o) => o.long === "--session-id");
    expect(opt).toBeDefined();
  });
});
