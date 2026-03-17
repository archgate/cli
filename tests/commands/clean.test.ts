import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerCleanCommand } from "../../src/commands/clean";

describe("registerCleanCommand", () => {
  test("registers 'clean' as a subcommand", () => {
    const program = new Command();
    registerCleanCommand(program);
    const sub = program.commands.find((c) => c.name() === "clean");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerCleanCommand(program);
    const sub = program.commands.find((c) => c.name() === "clean")!;
    expect(sub.description()).toBeTruthy();
  });
});
