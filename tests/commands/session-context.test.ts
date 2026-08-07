// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { Command } from "@commander-js/extra-typings";

import {
  parseMaxEntries,
  registerSessionContextCommand,
} from "../../src/commands/session-context";

/** Build a fresh program and return the registered `session-context` command. */
function sessionContext() {
  const program = new Command();
  registerSessionContextCommand(program);
  return program.commands.find((c) => c.name() === "session-context")!;
}

/** Resolve `session-context` itself, or one of its subcommands by name. */
function target(subcommand?: string) {
  const cmd = sessionContext();
  if (subcommand === undefined) return cmd;
  return cmd.commands.find((c) => c.name() === subcommand)!;
}

const EDITORS = ["claude-code", "copilot", "cursor", "opencode"];

describe("registerSessionContextCommand", () => {
  test("registers 'session-context' as a subcommand", () => {
    expect(sessionContext()).toBeDefined();
  });

  test("has a description", () => {
    expect(sessionContext().description()).toBeTruthy();
  });

  test("has exactly the list and show subcommands", () => {
    // Editors are selected with --editor, not with a subcommand each.
    expect(sessionContext().commands.map((c) => c.name())).toEqual([
      "list",
      "show",
    ]);
  });

  test("no longer registers a subcommand per editor", () => {
    const names = new Set(sessionContext().commands.map((c) => c.name()));
    expect(EDITORS.filter((e) => names.has(e))).toEqual([]);
  });

  describe("--editor", () => {
    test.each([
      ["session-context", undefined],
      ["list", "list"],
      ["show", "show"],
    ])("%s accepts --editor", (_label, subcommand) => {
      expect(target(subcommand).options.map((o) => o.long)).toContain(
        "--editor"
      );
    });

    test.each([
      ["session-context", undefined],
      ["list", "list"],
      ["show", "show"],
    ])("%s restricts --editor to the known editors", (_label, subcommand) => {
      const editor = target(subcommand).options.find(
        (o) => o.long === "--editor"
      )!;
      expect(editor.argChoices).toEqual(EDITORS);
    });

    test("--editor takes a value rather than being a boolean flag", () => {
      const editor = sessionContext().options.find(
        (o) => o.long === "--editor"
      )!;
      expect(editor.required).toBe(true);
    });
  });

  describe("--max-entries", () => {
    test.each([
      ["session-context", undefined],
      ["show", "show"],
    ])("%s accepts --max-entries", (_label, subcommand) => {
      expect(target(subcommand).options.map((o) => o.long)).toContain(
        "--max-entries"
      );
    });

    test("list does not accept --max-entries", () => {
      expect(target("list").options.map((o) => o.long)).not.toContain(
        "--max-entries"
      );
    });

    test.each([["0"], ["-1"], ["abc"], [""]])(
      "rejects %p as a max-entries value",
      (value) => {
        expect(() => parseMaxEntries(value)).toThrow();
      }
    );

    test("accepts a positive integer", () => {
      expect(parseMaxEntries("25")).toBe(25);
    });

    test("truncates a fractional value", () => {
      expect(parseMaxEntries("25.9")).toBe(25);
    });
  });

  describe("--root", () => {
    test.each([
      ["session-context", undefined],
      ["show", "show"],
    ])("%s accepts --root", (_label, subcommand) => {
      expect(target(subcommand).options.map((o) => o.long)).toContain("--root");
    });

    test("list does not accept --root", () => {
      expect(target("list").options.map((o) => o.long)).not.toContain("--root");
    });
  });

  describe("arguments", () => {
    test("show takes a session-id argument", () => {
      expect(target("show").registeredArguments.map((a) => a.name())).toEqual([
        "session-id",
      ]);
    });

    test("list takes no arguments", () => {
      expect(target("list").registeredArguments).toHaveLength(0);
    });
  });
});
