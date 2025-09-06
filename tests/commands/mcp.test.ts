import { describe, expect, test } from "bun:test";
import { Command } from "@commander-js/extra-typings";
import { registerMcpCommand } from "../../src/commands/mcp";

describe("registerMcpCommand", () => {
  test("registers 'mcp' as a subcommand", () => {
    const program = new Command();
    registerMcpCommand(program);
    const sub = program.commands.find((c) => c.name() === "mcp");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerMcpCommand(program);
    const sub = program.commands.find((c) => c.name() === "mcp")!;
    expect(sub.description()).toBeTruthy();
  });
});
