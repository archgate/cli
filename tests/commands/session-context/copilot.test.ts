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

const mockReadCopilotSession = mock(
  () =>
    Promise.resolve({ ok: true, data: {} }) as Promise<
      { ok: true; data: unknown } | { ok: false; error: string }
    >
);
const mockListCopilotSessions = mock(
  () =>
    Promise.resolve({ ok: true, data: { sessions: [] } }) as Promise<
      { ok: true; data: { sessions: unknown[] } } | { ok: false; error: string }
    >
);
mock.module("../../../src/helpers/session-context-copilot", () => ({
  readCopilotSession: mockReadCopilotSession,
  listCopilotSessions: mockListCopilotSessions,
}));

// ---------------------------------------------------------------------------
// Import under test — loaded AFTER mocks are registered.
// ---------------------------------------------------------------------------

import { registerCopilotSessionContextCommand } from "../../../src/commands/session-context/copilot";
import { safeRmSync } from "../../test-utils";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
});

describe("copilot action handler", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

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

    mockReadCopilotSession.mockReset();
    mockReadCopilotSession.mockResolvedValue({ ok: true, data: {} });
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
    registerCopilotSessionContextCommand(parent);
    return parent;
  }

  test("prints JSON on successful result", async () => {
    mockReadCopilotSession.mockResolvedValue({
      ok: true,
      data: { entries: [{ role: "assistant", content: "hi" }], total: 1 },
    });

    await makeProgram().parseAsync(["node", "session-context", "copilot"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("");
    const parsed = JSON.parse(output);
    expect(parsed.total).toBe(1);
  });

  test("exits 1 when reader returns error result", async () => {
    mockReadCopilotSession.mockResolvedValue({
      ok: false,
      error: "No copilot session found",
    });

    await expect(
      makeProgram().parseAsync(["node", "session-context", "copilot"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.join(" "))
      .join(" ");
    expect(errorOutput).toContain("No copilot session found");
  });

  test("exits 2 when unexpected error is thrown", async () => {
    mockReadCopilotSession.mockRejectedValue(new Error("Permission denied"));

    await expect(
      makeProgram().parseAsync(["node", "session-context", "copilot"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(2);
    const errorOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.join(" "))
      .join(" ");
    expect(errorOutput).toContain("Permission denied");
  });

  test("re-throws ExitPromptError", async () => {
    const exitPromptError = new Error("prompt cancelled");
    exitPromptError.name = "ExitPromptError";
    mockReadCopilotSession.mockRejectedValue(exitPromptError);

    await expect(
      makeProgram().parseAsync(["node", "session-context", "copilot"])
    ).rejects.toThrow("prompt cancelled");

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("passes findProjectRoot result to reader", async () => {
    mockReadCopilotSession.mockResolvedValue({ ok: true, data: {} });

    await makeProgram().parseAsync(["node", "session-context", "copilot"]);

    expect(mockReadCopilotSession).toHaveBeenCalledWith(tempDir, {
      maxEntries: undefined,
    });
  });
});
