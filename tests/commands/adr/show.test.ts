import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerAdrShowCommand } from "../../../src/commands/adr/show";

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
