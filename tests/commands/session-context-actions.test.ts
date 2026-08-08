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

import { registerSessionContextCommand } from "../../src/commands/session-context";
import * as auto from "../../src/helpers/session-context-auto";
import { UserError } from "../../src/helpers/user-error";
import { restoreEnv, safeRmSync } from "../test-utils";

// Action-handler behaviour lives here; command wiring (options, choices,
// subcommand shape) is asserted in session-context.test.ts.
describe("session-context action handlers", () => {
  let tempDir: string;
  let originalCwd: string;
  let savedCeiling: string | undefined;
  let logSpy: Mock<typeof console.log>;
  let errorSpy: Mock<typeof console.error>;
  let exitSpy: Mock<typeof process.exit>;
  let readSpy: Mock<typeof auto.readAutoSession>;
  let readByIdSpy: Mock<typeof auto.readAutoSessionById>;
  let listSpy: Mock<typeof auto.listAutoSessions>;

  const detection = {
    editor: "claude-code" as const,
    via: "CLAUDECODE",
    session: "recent" as const,
    candidates: ["claude-code" as const],
  };

  beforeEach(() => {
    // realpathSync normalizes the macOS /var → /private/var symlink so the
    // path matches what process.cwd() returns after chdir.
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "archgate-sc-action-")));
    originalCwd = process.cwd();
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    savedCeiling = Bun.env.ARCHGATE_PROJECT_CEILING;
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    process.chdir(tempDir);

    readSpy = spyOn(auto, "readAutoSession");
    readSpy.mockResolvedValue({
      ok: true,
      detection,
      data: { totalEntries: 0 },
    });
    readByIdSpy = spyOn(auto, "readAutoSessionById");
    readByIdSpy.mockResolvedValue({
      ok: true,
      detection: { ...detection, session: "explicit" },
      data: { totalEntries: 0 },
    });
    listSpy = spyOn(auto, "listAutoSessions");
    listSpy.mockResolvedValue({
      ok: true,
      detection: { editor: "claude-code", via: "CLAUDECODE", candidates: [] },
      sessions: [],
    });

    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    restoreEnv("ARCHGATE_PROJECT_CEILING", savedCeiling);
    safeRmSync(tempDir);
    readSpy.mockRestore();
    readByIdSpy.mockRestore();
    listSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  async function run(...argv: string[]) {
    const program = new Command().exitOverride();
    registerSessionContextCommand(program);
    return program.parseAsync(["node", "archgate", "session-context", ...argv]);
  }

  /**
   * Run a command whose action is expected to exit, and let it settle.
   *
   * The action awaits the reader before reaching `exitWith`, so the spies are
   * only meaningful once the returned promise has rejected. Draining it here
   * keeps every caller's assertions ordered after the exit.
   */
  async function runExpectingExit(...argv: string[]) {
    const settled = run(...argv);
    expect(settled).rejects.toThrow("process.exit");
    await settled.catch(() => {
      // The rejection is the assertion above; draining it just orders the
      // caller's spy checks after the exit.
    });
  }

  /** Parse whatever the handler printed to stdout. JSON.parse is untyped by nature. */
  function printed(): unknown {
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("");
    return JSON.parse(output);
  }

  const errorText = () => errorSpy.mock.calls.map((c) => c.join(" ")).join(" ");

  describe("reading the current session", () => {
    test("prints the detection block alongside the transcript", async () => {
      await run();

      expect(printed()).toMatchObject({
        detection: { editor: "claude-code", session: "recent" },
        totalEntries: 0,
      });
    });

    test("forwards --max-entries, --editor and --root", async () => {
      await run("--editor", "opencode", "--max-entries", "7", "--root");

      expect(readSpy).toHaveBeenCalledWith(tempDir, {
        maxEntries: 7,
        editor: "opencode",
        root: true,
      });
    });

    test("exits 1 when the reader reports a failure", async () => {
      readSpy.mockResolvedValue({ ok: false, error: "No session files found" });

      await runExpectingExit();
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorText()).toContain("No session files found");
    });

    test("exits 1 with guidance when no editor can be resolved", async () => {
      readSpy.mockRejectedValue(
        new UserError("Could not detect the AI editor from the environment.")
      );

      await runExpectingExit();
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorText()).toContain("Could not detect");
    });

    test("exits 2 on an unexpected error", async () => {
      readSpy.mockRejectedValue(new Error("Unexpected disk failure"));

      await runExpectingExit();
      expect(exitSpy).toHaveBeenCalledWith(2);
      expect(errorText()).toContain("Unexpected disk failure");
    });

    test("re-throws ExitPromptError so the entry point exits 130", async () => {
      const cancelled = new Error("prompt cancelled");
      cancelled.name = "ExitPromptError";
      readSpy.mockRejectedValue(cancelled);

      expect(run()).rejects.toThrow("prompt cancelled");
    });
  });

  describe("list", () => {
    test("prints the detection block alongside the sessions", async () => {
      listSpy.mockResolvedValue({
        ok: true,
        detection: { editor: "cursor", via: "--editor", candidates: [] },
        sessions: [{ id: "abc", updatedAt: "2026-01-01T00:00:00.000Z" }],
      });

      await run("list");

      expect(printed()).toMatchObject({
        detection: { editor: "cursor" },
        sessions: [{ id: "abc" }],
      });
    });

    test("forwards --editor", async () => {
      await run("list", "--editor", "copilot");

      expect(listSpy).toHaveBeenCalledWith(tempDir, { editor: "copilot" });
    });

    test("takes --editor from the parent command", async () => {
      // Commander hoists a parent-known option from anywhere on the line.
      await run("--editor", "cursor", "list");

      expect(listSpy).toHaveBeenCalledWith(tempDir, { editor: "cursor" });
    });

    test("exits 1 when listing fails", async () => {
      listSpy.mockResolvedValue({ ok: false, error: "No opencode database" });

      await runExpectingExit("list");
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorText()).toContain("No opencode database");
    });

    test("exits 2 on an unexpected error", async () => {
      listSpy.mockRejectedValue(new Error("boom"));

      await runExpectingExit("list");
      expect(exitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe("show", () => {
    test("prints the detection block for an explicitly named session", async () => {
      await run("show", "sess-1");

      expect(printed()).toMatchObject({ detection: { session: "explicit" } });
    });

    test("forwards the session id with --max-entries, --editor and --root", async () => {
      await run(
        "show",
        "sess-1",
        "--editor",
        "opencode",
        "--max-entries",
        "3",
        "--root"
      );

      expect(readByIdSpy).toHaveBeenCalledWith(tempDir, "sess-1", {
        maxEntries: 3,
        editor: "opencode",
        root: true,
      });
    });

    test("takes --max-entries and --editor from the parent command", async () => {
      await run("--max-entries", "9", "--editor", "cursor", "show", "sess-2");

      expect(readByIdSpy).toHaveBeenCalledWith(tempDir, "sess-2", {
        maxEntries: 9,
        editor: "cursor",
        root: undefined,
      });
    });

    test("exits 1 when the session is not found", async () => {
      readByIdSpy.mockResolvedValue({
        ok: false,
        error: "Session not found: nope",
      });

      await runExpectingExit("show", "nope");
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorText()).toContain("Session not found");
    });

    test("exits 1 when --root is rejected for the editor", async () => {
      readByIdSpy.mockRejectedValue(
        new UserError("--root applies only to opencode")
      );

      await runExpectingExit("show", "sess-1", "--root");
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorText()).toContain("--root applies only to opencode");
    });

    test("exits 2 on an unexpected error", async () => {
      readByIdSpy.mockRejectedValue(new Error("boom"));

      await runExpectingExit("show", "sess-1");
      expect(exitSpy).toHaveBeenCalledWith(2);
    });
  });
});
