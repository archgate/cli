import { describe, expect, test } from "bun:test";
import { Command } from "@commander-js/extra-typings";
import { registerAdrUpdateCommand } from "../../../src/commands/adr/update";

describe("registerAdrUpdateCommand", () => {
  test("registers 'update' as a subcommand", () => {
    const parent = new Command("adr");
    registerAdrUpdateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "update");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const parent = new Command("adr");
    registerAdrUpdateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "update")!;
    expect(sub.description()).toBeTruthy();
  });

  test("requires --id option", () => {
    const parent = new Command("adr");
    registerAdrUpdateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "update")!;
    const idOpt = sub.options.find((o) => o.long === "--id");
    expect(idOpt).toBeDefined();
    expect(idOpt!.required).toBe(true);
  });

  test("requires --body option", () => {
    const parent = new Command("adr");
    registerAdrUpdateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "update")!;
    const bodyOpt = sub.options.find((o) => o.long === "--body");
    expect(bodyOpt).toBeDefined();
    expect(bodyOpt!.required).toBe(true);
  });

  test("accepts --title option", () => {
    const parent = new Command("adr");
    registerAdrUpdateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "update")!;
    const titleOpt = sub.options.find((o) => o.long === "--title");
    expect(titleOpt).toBeDefined();
  });

  test("accepts --domain option", () => {
    const parent = new Command("adr");
    registerAdrUpdateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "update")!;
    const domainOpt = sub.options.find((o) => o.long === "--domain");
    expect(domainOpt).toBeDefined();
  });

  test("accepts --json option", () => {
    const parent = new Command("adr");
    registerAdrUpdateCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "update")!;
    const jsonOpt = sub.options.find((o) => o.long === "--json");
    expect(jsonOpt).toBeDefined();
  });
});
