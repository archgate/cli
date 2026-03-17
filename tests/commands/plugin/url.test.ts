import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerPluginUrlCommand } from "../../../src/commands/plugin/url";

describe("registerPluginUrlCommand", () => {
  test("registers 'url' as a subcommand", () => {
    const program = new Command();
    registerPluginUrlCommand(program);
    const sub = program.commands.find((c) => c.name() === "url");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerPluginUrlCommand(program);
    const sub = program.commands.find((c) => c.name() === "url")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --editor option with default 'claude'", () => {
    const program = new Command();
    registerPluginUrlCommand(program);
    const sub = program.commands.find((c) => c.name() === "url")!;
    const editorOpt = sub.options.find((o) => o.long === "--editor");
    expect(editorOpt).toBeDefined();
    expect(editorOpt!.defaultValue).toBe("claude");
  });

  test("--editor option restricts choices to valid editors", () => {
    const program = new Command();
    registerPluginUrlCommand(program);
    const sub = program.commands.find((c) => c.name() === "url")!;
    const editorOpt = sub.options.find((o) => o.long === "--editor")!;
    expect(editorOpt.argChoices).toEqual([
      "claude",
      "cursor",
      "vscode",
      "copilot",
    ]);
  });
});
