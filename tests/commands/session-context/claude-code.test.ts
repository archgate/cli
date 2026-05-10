// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import { registerClaudeCodeSessionContextCommand } from "../../../src/commands/session-context/claude-code";

describe("registerClaudeCodeSessionContextCommand", () => {
  test("registers 'claude-code' as a subcommand", () => {
    const parent = new Command("session-context");
    registerClaudeCodeSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "claude-code");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const parent = new Command("session-context");
    registerClaudeCodeSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "claude-code")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --max-entries option", () => {
    const parent = new Command("session-context");
    registerClaudeCodeSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "claude-code")!;
    const opt = sub.options.find((o) => o.long === "--max-entries");
    expect(opt).toBeDefined();
  });
});
