import { describe, expect, test } from "bun:test";
import { Command } from "@commander-js/extra-typings";
import { registerLoginCommand } from "../../src/commands/login";

describe("registerLoginCommand", () => {
  test("registers 'login' as a subcommand", () => {
    const program = new Command();
    registerLoginCommand(program);
    const sub = program.commands.find((c) => c.name() === "login");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerLoginCommand(program);
    const sub = program.commands.find((c) => c.name() === "login")!;
    expect(sub.description()).toBeTruthy();
  });

  test("registers status subcommand", () => {
    const program = new Command();
    registerLoginCommand(program);
    const login = program.commands.find((c) => c.name() === "login")!;
    const status = login.commands.find((c) => c.name() === "status");
    expect(status).toBeDefined();
  });

  test("registers logout subcommand", () => {
    const program = new Command();
    registerLoginCommand(program);
    const login = program.commands.find((c) => c.name() === "login")!;
    const logout = login.commands.find((c) => c.name() === "logout");
    expect(logout).toBeDefined();
  });

  test("registers refresh subcommand", () => {
    const program = new Command();
    registerLoginCommand(program);
    const login = program.commands.find((c) => c.name() === "login")!;
    const refresh = login.commands.find((c) => c.name() === "refresh");
    expect(refresh).toBeDefined();
  });
});
