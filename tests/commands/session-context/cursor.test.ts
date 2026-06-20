// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

// ---------------------------------------------------------------------------
// Module mocks — declared before the import under test.
// ---------------------------------------------------------------------------

const mockReadCursorSession = mock(
  () =>
    Promise.resolve({ ok: true, data: {} }) as Promise<
      { ok: true; data: unknown } | { ok: false; error: string }
    >
);
mock.module("../../../src/helpers/session-context", () => ({
  readCursorSession: mockReadCursorSession,
}));

// ---------------------------------------------------------------------------
// Import under test — loaded AFTER mocks are registered.
// ---------------------------------------------------------------------------

import { registerCursorSessionContextCommand } from "../../../src/commands/session-context/cursor";
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

  test("accepts --session-id option", () => {
    const parent = new Command("session-context");
    registerCursorSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "cursor")!;
    const opt = sub.options.find((o) => o.long === "--session-id");
    expect(opt).toBeDefined();
  });
});

describe("cursor action handler", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

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

    mockReadCursorSession.mockReset();
    mockReadCursorSession.mockResolvedValue({ ok: true, data: {} });
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
    mockReadCursorSession.mockResolvedValue({
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
    mockReadCursorSession.mockResolvedValue({
      ok: false,
      error: "No cursor session found",
    });

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
    mockReadCursorSession.mockRejectedValue(new Error("File system error"));

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
    mockReadCursorSession.mockRejectedValue(exitPromptError);

    await expect(
      makeProgram().parseAsync(["node", "session-context", "cursor"])
    ).rejects.toThrow("prompt cancelled");

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("passes findProjectRoot result to reader", async () => {
    mockReadCursorSession.mockResolvedValue({ ok: true, data: {} });

    await makeProgram().parseAsync(["node", "session-context", "cursor"]);

    expect(mockReadCursorSession).toHaveBeenCalledWith(tempDir, {
      maxEntries: undefined,
      skip: 0,
      sessionId: undefined,
    });
  });
});
