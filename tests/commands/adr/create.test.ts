import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerAdrCreateCommand } from "../../../src/commands/adr/create";

describe("registerAdrCreateCommand", () => {
  test("registers 'create' as a subcommand", () => {
    const parent = new Command("adr");
    registerAdrCreateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "create");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const parent = new Command("adr");
    registerAdrCreateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "create")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --title option", () => {
    const parent = new Command("adr");
    registerAdrCreateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "create")!;
    const titleOpt = sub.options.find((o) => o.long === "--title");
    expect(titleOpt).toBeDefined();
  });

  test("accepts --domain option", () => {
    const parent = new Command("adr");
    registerAdrCreateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "create")!;
    const domainOpt = sub.options.find((o) => o.long === "--domain");
    expect(domainOpt).toBeDefined();
  });
});
