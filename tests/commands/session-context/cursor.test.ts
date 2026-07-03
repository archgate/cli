// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerCursorSessionContextCommand } from "../../../src/commands/session-context/cursor";
import * as sessionContextHelpers from "../../../src/helpers/session-context";
import { safeRmSync } from "../../test-utils";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerCursorSessionContextCommand", () => {
  test("registers 'cursor' as a subcommand", () => {
    const parent = new Command("session-context");
    registerCursorSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "cursor");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const parent = new Command("session-context");
    registerCursorSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "cursor")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --max-entries option", () => {
    const parent = new Command("session-context");
    registerCursorSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "cursor")!;
    const opt = sub.options.find((o) => o.long === "--max-entries");
    expect(opt).toBeDefined();
  });

  test("has list and show subcommands", () => {
    const parent = new Command("session-context");
    registerCursorSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "cursor")!;
    expect(sub.commands.map((c) => c.name()).sort()).toEqual(["list", "show"]);
  });
});

describe("cursor action handler", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  let readSpy: ReturnType<typeof spyOn>;

  /** Minimal complete summary for the default happy-path spy. */
  function emptySummary() {
    return {
      sessionId: "s",
      sessionFile: "s.jsonl",
      totalEntries: 0,
      relevantEntries: 0,
      transcript: [],
    };
  }

  beforeEach(() => {
    // realpathSync normalizes macOS /var → /private/var symlink so the
    // path matches what process.cwd() returns after chdir.
    tempDir = realpathSync(
      mkdtempSync(join(tmpdir(), "archgate-cursor-test-"))
    );
    originalCwd = process.cwd();
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    process.chdir(tempDir);

    readSpy = spyOn(sessionContextHelpers, "readCursorSession");
    readSpy.mockResolvedValue({ ok: true, data: emptySummary() });
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete Bun.env.ARCHGATE_PROJECT_CEILING;
    safeRmSync(tempDir);
    readSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  function makeProgram(): Command {
    const parent = new Command("session-context").exitOverride();
    registerCursorSessionContextCommand(parent);
    return parent;
  }

  test("prints JSON on successful result", async () => {
    readSpy.mockResolvedValue({
      ok: true,
      data: { entries: [{ role: "user", content: "test" }], total: 1 },
    });

    await makeProgram().parseAsync(["node", "session-context", "cursor"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("");
    const parsed = JSON.parse(output);
    expect(parsed.total).toBe(1);
  });

  test("exits 1 when reader returns error result", async () => {
    readSpy.mockResolvedValue({ ok: false, error: "No cursor session found" });

    await expect(
      makeProgram().parseAsync(["node", "session-context", "cursor"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.join(" "))
      .join(" ");
    expect(errorOutput).toContain("No cursor session found");
  });

  test("exits 2 when unexpected error is thrown", async () => {
    readSpy.mockRejectedValue(new Error("File system error"));

    await expect(
      makeProgram().parseAsync(["node", "session-context", "cursor"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(2);
    const errorOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.join(" "))
      .join(" ");
    expect(errorOutput).toContain("File system error");
  });

  test("re-throws ExitPromptError", async () => {
    const exitPromptError = new Error("prompt cancelled");
    exitPromptError.name = "ExitPromptError";
    readSpy.mockRejectedValue(exitPromptError);

    await expect(
      makeProgram().parseAsync(["node", "session-context", "cursor"])
    ).rejects.toThrow("prompt cancelled");

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("passes findProjectRoot result to reader", async () => {
    readSpy.mockResolvedValue({ ok: true, data: {} });

    await makeProgram().parseAsync(["node", "session-context", "cursor"]);

    expect(readSpy).toHaveBeenCalledWith(tempDir, { maxEntries: undefined });
  });

  test("list subcommand prints sessions", async () => {
    const listSpy = spyOn(sessionContextHelpers, "listCursorSessions");
    try {
      listSpy.mockResolvedValue({
        ok: true,
        data: { sessions: [{ id: "abc", updatedAt: "2026-01-01T00:00:00Z" }] },
      });

      await makeProgram().parseAsync([
        "node",
        "session-context",
        "cursor",
        "list",
      ]);

      expect(listSpy).toHaveBeenCalledWith(tempDir);
      const output = logSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join("");
      expect(JSON.parse(output).sessions[0].id).toBe("abc");
    } finally {
      listSpy.mockRestore();
    }
  });

  test("list subcommand exits 1 on error result", async () => {
    const listSpy = spyOn(sessionContextHelpers, "listCursorSessions");
    try {
      listSpy.mockResolvedValue({ ok: false, error: "store missing" });

      await expect(
        makeProgram().parseAsync(["node", "session-context", "cursor", "list"])
      ).rejects.toThrow("process.exit");

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errorOutput = errorSpy.mock.calls
        .map((c: unknown[]) => c.join(" "))
        .join(" ");
      expect(errorOutput).toContain("store missing");
    } finally {
      listSpy.mockRestore();
    }
  });

  test("show subcommand reads the given session id", async () => {
    readSpy.mockResolvedValue({ ok: true, data: emptySummary() });

    await makeProgram().parseAsync([
      "node",
      "session-context",
      "cursor",
      "show",
      "abc123",
    ]);

    expect(readSpy).toHaveBeenCalledWith(tempDir, {
      maxEntries: undefined,
      sessionId: "abc123",
    });
  });

  test("show subcommand exits 1 on error result", async () => {
    readSpy.mockResolvedValue({
      ok: false,
      error: "Session not found: abc123",
    });

    await expect(
      makeProgram().parseAsync([
        "node",
        "session-context",
        "cursor",
        "show",
        "abc123",
      ])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("show subcommand applies --max-entries (hoisted by the parent)", async () => {
    readSpy.mockResolvedValue({ ok: true, data: emptySummary() });

    // Regression: the parent editor command also declares --max-entries and
    // commander hoists parent-known options from anywhere in argv, so the
    // child must read the merged value via optsWithGlobals().
    await makeProgram().parseAsync([
      "node",
      "session-context",
      "cursor",
      "show",
      "abc123",
      "--max-entries",
      "2",
    ]);

    expect(readSpy).toHaveBeenCalledWith(tempDir, {
      maxEntries: 2,
      sessionId: "abc123",
    });
  });
});
