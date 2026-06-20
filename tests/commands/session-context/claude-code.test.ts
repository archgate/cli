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
//
// Only the session reader is mocked (unique to this command, no leak risk).
// findProjectRoot is controlled via process.chdir + ARCHGATE_PROJECT_CEILING
// to avoid Bun mock.module global-leak issues.
// ---------------------------------------------------------------------------

const mockReadClaudeCodeSession = mock(
  () =>
    Promise.resolve({ ok: true, data: {} }) as Promise<
      { ok: true; data: unknown } | { ok: false; error: string }
    >
);
mock.module("../../../src/helpers/session-context", () => ({
  readClaudeCodeSession: mockReadClaudeCodeSession,
}));

// ---------------------------------------------------------------------------
// Import under test — loaded AFTER mocks are registered.
// ---------------------------------------------------------------------------

import { registerClaudeCodeSessionContextCommand } from "../../../src/commands/session-context/claude-code";
import { safeRmSync } from "../../test-utils";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

describe("claude-code action handler", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // realpathSync normalizes macOS /var → /private/var symlink so the
    // path matches what process.cwd() returns after chdir.
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "archgate-cc-test-")));
    originalCwd = process.cwd();
    // Create .archgate/ so findProjectRoot returns this dir
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    process.chdir(tempDir);

    mockReadClaudeCodeSession.mockReset();
    mockReadClaudeCodeSession.mockResolvedValue({ ok: true, data: {} });
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
    registerClaudeCodeSessionContextCommand(parent);
    return parent;
  }

  test("prints JSON on successful result", async () => {
    mockReadClaudeCodeSession.mockResolvedValue({
      ok: true,
      data: { entries: [{ role: "user", content: "hello" }], total: 1 },
    });

    await makeProgram().parseAsync(["node", "session-context", "claude-code"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("");
    const parsed = JSON.parse(output);
    expect(parsed.total).toBe(1);
  });

  test("exits 1 when reader returns error result", async () => {
    mockReadClaudeCodeSession.mockResolvedValue({
      ok: false,
      error: "No session found",
    });

    await expect(
      makeProgram().parseAsync(["node", "session-context", "claude-code"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.join(" "))
      .join(" ");
    expect(errorOutput).toContain("No session found");
  });

  test("exits 2 when unexpected error is thrown", async () => {
    mockReadClaudeCodeSession.mockRejectedValue(
      new Error("Unexpected disk failure")
    );

    await expect(
      makeProgram().parseAsync(["node", "session-context", "claude-code"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(2);
    const errorOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.join(" "))
      .join(" ");
    expect(errorOutput).toContain("Unexpected disk failure");
  });

  test("re-throws ExitPromptError", async () => {
    const exitPromptError = new Error("prompt cancelled");
    exitPromptError.name = "ExitPromptError";
    mockReadClaudeCodeSession.mockRejectedValue(exitPromptError);

    await expect(
      makeProgram().parseAsync(["node", "session-context", "claude-code"])
    ).rejects.toThrow("prompt cancelled");

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("passes findProjectRoot result to reader", async () => {
    mockReadClaudeCodeSession.mockResolvedValue({ ok: true, data: {} });

    await makeProgram().parseAsync(["node", "session-context", "claude-code"]);

    // findProjectRoot found our tempDir (which has .archgate/)
    expect(mockReadClaudeCodeSession).toHaveBeenCalledWith(tempDir, {
      maxEntries: undefined,
      skip: 0,
    });
  });
});
