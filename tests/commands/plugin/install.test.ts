import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerPluginInstallCommand } from "../../../src/commands/plugin/install";

describe("registerPluginInstallCommand", () => {
  test("registers 'install' as a subcommand", () => {
    const program = new Command();
    registerPluginInstallCommand(program);
    const sub = program.commands.find((c) => c.name() === "install");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerPluginInstallCommand(program);
    const sub = program.commands.find((c) => c.name() === "install")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --editor option with default 'claude'", () => {
    const program = new Command();
    registerPluginInstallCommand(program);
    const sub = program.commands.find((c) => c.name() === "install")!;
    const editorOpt = sub.options.find((o) => o.long === "--editor");
    expect(editorOpt).toBeDefined();
    expect(editorOpt!.defaultValue).toBe("claude");
  });

  test("--editor option restricts choices to valid editors", () => {
    const program = new Command();
    registerPluginInstallCommand(program);
    const sub = program.commands.find((c) => c.name() === "install")!;
    const editorOpt = sub.options.find((o) => o.long === "--editor")!;
    expect(editorOpt.argChoices).toEqual([
      "claude",
      "cursor",
      "vscode",
      "copilot",
    ]);
  });
});
