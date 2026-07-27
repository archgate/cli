// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
  type Mock,
} from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerCopilotSessionContextCommand } from "../../../src/commands/session-context/copilot";
import * as copilotHelpers from "../../../src/helpers/session-context-copilot";
import { safeRmSync } from "../../test-utils";

describe("registerCopilotSessionContextCommand", () => {
  test("registers 'copilot' as a subcommand", () => {
    const parent = new Command("session-context");
    registerCopilotSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "copilot");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const parent = new Command("session-context");
    registerCopilotSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "copilot")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --max-entries option", () => {
    const parent = new Command("session-context");
    registerCopilotSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "copilot")!;
    const opt = sub.options.find((o) => o.long === "--max-entries");
    expect(opt).toBeDefined();
  });

  test("has list and show subcommands", () => {
    const parent = new Command("session-context");
    registerCopilotSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "copilot")!;
    expect(sub.commands.map((c) => c.name()).sort()).toEqual(["list", "show"]);
  });
});

describe("copilot action handler", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: Mock<typeof console.log>;
  let errorSpy: Mock<typeof console.error>;
  let exitSpy: Mock<typeof process.exit>;
  let readSpy: Mock<typeof copilotHelpers.readCopilotSession>;
  let listSpy: Mock<typeof copilotHelpers.listCopilotSessions>;

  /** Minimal complete summary for the default happy-path spy. */
  function emptySummary() {
    return {
      sessionId: "s",
      sessionFile: "events.jsonl",
      totalEntries: 0,
      relevantEntries: 0,
      transcript: [],
    };
  }

  beforeEach(() => {
    // realpathSync normalizes macOS /var → /private/var symlink so the
    // path matches what process.cwd() returns after chdir.
    tempDir = realpathSync(
      mkdtempSync(join(tmpdir(), "archgate-copilot-test-"))
    );
    originalCwd = process.cwd();
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    process.chdir(tempDir);

    readSpy = spyOn(copilotHelpers, "readCopilotSession");
    readSpy.mockResolvedValue({ ok: true, data: emptySummary() });
    listSpy = spyOn(copilotHelpers, "listCopilotSessions");
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
    listSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  function makeProgram(): Command {
    const parent = new Command("session-context").exitOverride();
    registerCopilotSessionContextCommand(parent);
    return parent;
  }

  test("prints JSON on successful result", async () => {
    // The handler only JSON-serializes `data` verbatim, so a fake shape
    // (not the real CopilotSessionSummary) is enough to exercise passthrough.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    readSpy.mockResolvedValue({
      ok: true,
      data: { entries: [{ role: "assistant", content: "hi" }], total: 1 },
    } as unknown as Awaited<
      ReturnType<typeof copilotHelpers.readCopilotSession>
    >);

    await makeProgram().parseAsync(["node", "session-context", "copilot"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed: unknown = JSON.parse(output);
    // Shape matches the fixture printed above; JSON.parse is untyped by nature.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    expect((parsed as { total: number }).total).toBe(1);
  });

  test("exits 1 when reader returns error result", () => {
    readSpy.mockResolvedValue({ ok: false, error: "No copilot session found" });

    expect(
      makeProgram().parseAsync(["node", "session-context", "copilot"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorOutput = errorSpy.mock.calls.map((c) => c.join(" ")).join(" ");
    expect(errorOutput).toContain("No copilot session found");
  });

  test("exits 2 when unexpected error is thrown", () => {
    readSpy.mockRejectedValue(new Error("Permission denied"));

    expect(
      makeProgram().parseAsync(["node", "session-context", "copilot"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(2);
    const errorOutput = errorSpy.mock.calls.map((c) => c.join(" ")).join(" ");
    expect(errorOutput).toContain("Permission denied");
  });

  test("re-throws ExitPromptError", () => {
    const exitPromptError = new Error("prompt cancelled");
    exitPromptError.name = "ExitPromptError";
    readSpy.mockRejectedValue(exitPromptError);

    expect(
      makeProgram().parseAsync(["node", "session-context", "copilot"])
    ).rejects.toThrow("prompt cancelled");

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("passes findProjectRoot result to reader", async () => {
    readSpy.mockResolvedValue({ ok: true, data: emptySummary() });

    await makeProgram().parseAsync(["node", "session-context", "copilot"]);

    expect(readSpy).toHaveBeenCalledWith(tempDir, { maxEntries: undefined });
  });

  test("list subcommand prints sessions", async () => {
    listSpy.mockResolvedValue({
      ok: true,
      data: { sessions: [{ id: "abc", updatedAt: "2026-01-01T00:00:00Z" }] },
    });

    await makeProgram().parseAsync([
      "node",
      "session-context",
      "copilot",
      "list",
    ]);

    expect(listSpy).toHaveBeenCalledWith(tempDir);
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("");
    // Shape matches the fixture printed above; JSON.parse is untyped by nature.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const parsed = JSON.parse(output) as { sessions: Array<{ id: string }> };
    expect(parsed.sessions[0]?.id).toBe("abc");
  });

  test("list subcommand exits 1 on error result", () => {
    listSpy.mockResolvedValue({ ok: false, error: "store missing" });

    expect(
      makeProgram().parseAsync(["node", "session-context", "copilot", "list"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorOutput = errorSpy.mock.calls.map((c) => c.join(" ")).join(" ");
    expect(errorOutput).toContain("store missing");
  });

  test("show subcommand reads the given session id", async () => {
    readSpy.mockResolvedValue({ ok: true, data: emptySummary() });

    await makeProgram().parseAsync([
      "node",
      "session-context",
      "copilot",
      "show",
      "abc123",
    ]);

    expect(readSpy).toHaveBeenCalledWith(tempDir, {
      maxEntries: undefined,
      sessionId: "abc123",
    });
  });

  test("show subcommand exits 1 on error result", () => {
    readSpy.mockResolvedValue({
      ok: false,
      error: "Session not found: abc123",
    });

    expect(
      makeProgram().parseAsync([
        "node",
        "session-context",
        "copilot",
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
      "copilot",
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
