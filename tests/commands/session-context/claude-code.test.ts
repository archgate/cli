// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerClaudeCodeSessionContextCommand } from "../../../src/commands/session-context/claude-code";
import * as sessionContextHelpers from "../../../src/helpers/session-context";
import { runCli } from "../../integration/cli-harness";
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

  test("has list and show subcommands", () => {
    const parent = new Command("session-context");
    registerClaudeCodeSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "claude-code")!;
    expect(sub.commands.map((c) => c.name()).sort()).toEqual(["list", "show"]);
  });
});

describe("claude-code action handler", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  let readSpy: ReturnType<typeof spyOn>;

  /** Minimal complete summary for the default happy-path spy. */
  function emptySummary() {
    return {
      sessionFile: "s.jsonl",
      totalEntries: 0,
      relevantEntries: 0,
      transcript: [],
    };
  }

  beforeEach(() => {
    // realpathSync normalizes macOS /var → /private/var symlink so the
    // path matches what process.cwd() returns after chdir.
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "archgate-cc-test-")));
    originalCwd = process.cwd();
    // Create .archgate/ so findProjectRoot returns this dir
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    process.chdir(tempDir);

    readSpy = spyOn(sessionContextHelpers, "readClaudeCodeSession");
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
    registerClaudeCodeSessionContextCommand(parent);
    return parent;
  }

  test("prints JSON on successful result", async () => {
    readSpy.mockResolvedValue({
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
    readSpy.mockResolvedValue({ ok: false, error: "No session found" });

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
    readSpy.mockRejectedValue(new Error("Unexpected disk failure"));

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
    readSpy.mockRejectedValue(exitPromptError);

    await expect(
      makeProgram().parseAsync(["node", "session-context", "claude-code"])
    ).rejects.toThrow("prompt cancelled");

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("passes findProjectRoot result to reader", async () => {
    readSpy.mockResolvedValue({ ok: true, data: {} });

    await makeProgram().parseAsync(["node", "session-context", "claude-code"]);

    // findProjectRoot found our tempDir (which has .archgate/)
    expect(readSpy).toHaveBeenCalledWith(tempDir, { maxEntries: undefined });
  });

  test("list subcommand prints sessions", async () => {
    const listSpy = spyOn(sessionContextHelpers, "listClaudeCodeSessions");
    try {
      listSpy.mockResolvedValue({
        ok: true,
        data: { sessions: [{ id: "abc", updatedAt: "2026-01-01T00:00:00Z" }] },
      });

      await makeProgram().parseAsync([
        "node",
        "session-context",
        "claude-code",
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
    const listSpy = spyOn(sessionContextHelpers, "listClaudeCodeSessions");
    try {
      listSpy.mockResolvedValue({ ok: false, error: "store missing" });

      await expect(
        makeProgram().parseAsync([
          "node",
          "session-context",
          "claude-code",
          "list",
        ])
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
      "claude-code",
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
        "claude-code",
        "show",
        "abc123",
      ])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("claude-code list/show (CLI subprocess)", () => {
  // Subprocess tests avoid Bun's process-global mock.module state — this
  // file mocks the read helper for the in-process tests above, so the
  // nested subcommands are exercised against real stores in a child
  // process with HOME/USERPROFILE redirected.
  let tempHome: string;
  let projectDir: string;
  let env: Record<string, string>;

  function encodeClaude(p: string): string {
    return p
      .replaceAll("\\", "-")
      .replaceAll("/", "-")
      .replaceAll(":", "-")
      .replaceAll(".", "-");
  }

  beforeEach(() => {
    tempHome = realpathSync(mkdtempSync(join(tmpdir(), "archgate-cc-home-")));
    projectDir = join(tempHome, "project");
    mkdirSync(join(projectDir, ".archgate", "adrs"), { recursive: true });
    env = { HOME: tempHome, USERPROFILE: tempHome };
  });

  afterEach(() => {
    safeRmSync(tempHome);
  });

  function seedSession(id: string, content: string): void {
    const dir = join(tempHome, ".claude", "projects", encodeClaude(projectDir));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${id}.jsonl`),
      JSON.stringify({ type: "user", message: { role: "user", content } })
    );
  }

  test("list returns the project's sessions", async () => {
    seedSession("abc123", "hi");

    const { exitCode, stdout } = await runCli(
      ["session-context", "claude-code", "list"],
      projectDir,
      env
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      sessions: Array<{ id: string; updatedAt: string }>;
    };
    expect(parsed.sessions.map((s) => s.id)).toEqual(["abc123"]);
    expect(Date.parse(parsed.sessions[0]?.updatedAt ?? "")).not.toBeNaN();
  });

  test("show reads a specific session by id", async () => {
    seedSession("older", "earlier content");
    seedSession("newer", "current content");

    const { exitCode, stdout } = await runCli(
      ["session-context", "claude-code", "show", "older"],
      projectDir,
      env
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      sessionFile: string;
      transcript: Array<{ contentPreview: string }>;
    };
    expect(parsed.sessionFile).toBe("older.jsonl");
    expect(parsed.transcript[0]?.contentPreview).toBe("earlier content");
  });

  test("show with an unknown id exits 1", async () => {
    seedSession("only", "hi");

    const { exitCode, stderr } = await runCli(
      ["session-context", "claude-code", "show", "nope"],
      projectDir,
      env
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Session not found: nope");
  });
});
