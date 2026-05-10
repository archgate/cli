// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerAdrCommand } from "../../../src/commands/adr/index";

describe("registerAdrCommand", () => {
  test("registers 'adr' as a subcommand", () => {
    const program = new Command();
    registerAdrCommand(program);
    const sub = program.commands.find((c) => c.name() === "adr");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerAdrCommand(program);
    const sub = program.commands.find((c) => c.name() === "adr")!;
    expect(sub.description()).toBeTruthy();
  });

  test("registers 'create' subcommand", () => {
    const program = new Command();
    registerAdrCommand(program);
    const adr = program.commands.find((c) => c.name() === "adr")!;
    expect(adr.commands.find((c) => c.name() === "create")).toBeDefined();
  });

  test("registers 'list' subcommand", () => {
    const program = new Command();
    registerAdrCommand(program);
    const adr = program.commands.find((c) => c.name() === "adr")!;
    expect(adr.commands.find((c) => c.name() === "list")).toBeDefined();
  });

  test("registers 'show' subcommand", () => {
    const program = new Command();
    registerAdrCommand(program);
    const adr = program.commands.find((c) => c.name() === "adr")!;
    expect(adr.commands.find((c) => c.name() === "show")).toBeDefined();
  });

  test("registers 'update' subcommand", () => {
    const program = new Command();
    registerAdrCommand(program);
    const adr = program.commands.find((c) => c.name() === "adr")!;
    expect(adr.commands.find((c) => c.name() === "update")).toBeDefined();
  });
});
