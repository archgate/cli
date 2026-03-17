import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerUpgradeCommand } from "../../src/commands/upgrade";

describe("registerUpgradeCommand", () => {
  test("registers 'upgrade' as a subcommand", () => {
    const program = new Command();
    registerUpgradeCommand(program);
    const sub = program.commands.find((c) => c.name() === "upgrade");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerUpgradeCommand(program);
    const sub = program.commands.find((c) => c.name() === "upgrade")!;
    expect(sub.description()).toBeTruthy();
  });
});
