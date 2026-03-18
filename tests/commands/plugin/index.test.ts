import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerPluginCommand } from "../../../src/commands/plugin/index";

describe("registerPluginCommand", () => {
  test("registers 'plugin' as a subcommand", () => {
    const program = new Command();
    registerPluginCommand(program);
    const sub = program.commands.find((c) => c.name() === "plugin");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerPluginCommand(program);
    const sub = program.commands.find((c) => c.name() === "plugin")!;
    expect(sub.description()).toBeTruthy();
  });

  test("registers 'url' subcommand", () => {
    const program = new Command();
    registerPluginCommand(program);
    const plugin = program.commands.find((c) => c.name() === "plugin")!;
    expect(plugin.commands.find((c) => c.name() === "url")).toBeDefined();
  });

  test("registers 'install' subcommand", () => {
    const program = new Command();
    registerPluginCommand(program);
    const plugin = program.commands.find((c) => c.name() === "plugin")!;
    expect(plugin.commands.find((c) => c.name() === "install")).toBeDefined();
  });
});
