import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerPluginCommand } from "../../../src/commands/plugin/index";

const createProgramAndPlugin = () => {
  const program = new Command();
  registerPluginCommand(program);
  const plugin = program.commands.find((c) => c.name() === "plugin")!;
  return { program, plugin };
};

describe("registerPluginCommand", () => {
  test("registers 'plugin' as a subcommand", () => {
    const { plugin } = createProgramAndPlugin();
    expect(plugin).toBeDefined();
  });

  test("has a description", () => {
    const { plugin } = createProgramAndPlugin();
    expect(plugin.description()).toBeTruthy();
  });

  test("registers 'url' subcommand", () => {
    const { plugin } = createProgramAndPlugin();
    expect(plugin.commands.find((c) => c.name() === "url")).toBeDefined();
  });

  test("registers 'install' subcommand", () => {
    const { plugin } = createProgramAndPlugin();
    expect(plugin.commands.find((c) => c.name() === "install")).toBeDefined();
  });
});
