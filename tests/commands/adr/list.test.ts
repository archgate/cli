import { describe, expect, test } from "bun:test";
import { Command } from "@commander-js/extra-typings";
import { registerAdrListCommand } from "../../../src/commands/adr/list";

describe("registerAdrListCommand", () => {
  test("registers 'list' as a subcommand", () => {
    const parent = new Command("adr");
    registerAdrListCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "list");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const parent = new Command("adr");
    registerAdrListCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "list")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --json option", () => {
    const parent = new Command("adr");
    registerAdrListCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "list")!;
    const jsonOpt = sub.options.find((o) => o.long === "--json");
    expect(jsonOpt).toBeDefined();
  });

  test("accepts --domain option", () => {
    const parent = new Command("adr");
    registerAdrListCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "list")!;
    const domainOpt = sub.options.find((o) => o.long === "--domain");
    expect(domainOpt).toBeDefined();
  });
});
