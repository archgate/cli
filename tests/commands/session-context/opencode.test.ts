// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerOpencodeSessionContextCommand } from "../../../src/commands/session-context/opencode";
import * as opencodeHelpers from "../../../src/helpers/session-context-opencode";
import { runCli } from "../../integration/cli-harness";
import { safeRmSync } from "../../test-utils";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerOpencodeSessionContextCommand", () => {
  test("registers 'opencode' as a subcommand", () => {
    const parent = new Command("session-context");
    registerOpencodeSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "opencode");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const parent = new Command("session-context");
    registerOpencodeSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "opencode")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --max-entries option", () => {
    const parent = new Command("session-context");
    registerOpencodeSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "opencode")!;
    const opt = sub.options.find((o) => o.long === "--max-entries");
    expect(opt).toBeDefined();
  });

  test("has list and show subcommands; --root only on show", () => {
    const parent = new Command("session-context");
    registerOpencodeSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "opencode")!;
    expect(sub.commands.map((c) => c.name()).sort()).toEqual(["list", "show"]);
    const show = sub.commands.find((c) => c.name() === "show")!;
    expect(show.options.map((o) => o.long)).toContain("--root");
    expect(sub.options.map((o) => o.long)).not.toContain("--root");
  });
});

describe("opencode action handler", () => {
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
      totalEntries: 0,
      relevantEntries: 0,
      transcript: [],
    };
  }

  beforeEach(() => {
    // realpathSync normalizes macOS /var → /private/var symlink so the
    // path matches what process.cwd() returns after chdir.
    tempDir = realpathSync(
      mkdtempSync(join(tmpdir(), "archgate-opencode-test-"))
    );
    originalCwd = process.cwd();
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    process.chdir(tempDir);

    readSpy = spyOn(opencodeHelpers, "readOpencodeSession");
    readSpy.mockReturnValue({ ok: true, data: emptySummary() });
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
    registerOpencodeSessionContextCommand(parent);
    return parent;
  }

  test("prints JSON on successful result", async () => {
    readSpy.mockReturnValue({
      ok: true,
      data: { entries: [{ role: "assistant", content: "done" }], total: 1 },
    });

    await makeProgram().parseAsync(["node", "session-context", "opencode"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("");
    const parsed = JSON.parse(output);
    expect(parsed.total).toBe(1);
  });

  test("exits 1 when reader returns error result", async () => {
    readSpy.mockReturnValue({ ok: false, error: "No opencode session found" });

    await expect(
      makeProgram().parseAsync(["node", "session-context", "opencode"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.join(" "))
      .join(" ");
    expect(errorOutput).toContain("No opencode session found");
  });

  test("exits 2 when unexpected error is thrown", async () => {
    readSpy.mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });

    await expect(
      makeProgram().parseAsync(["node", "session-context", "opencode"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(2);
    const errorOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.join(" "))
      .join(" ");
    expect(errorOutput).toContain("ENOENT: no such file");
  });

  test("re-throws ExitPromptError", async () => {
    const exitPromptError = new Error("prompt cancelled");
    exitPromptError.name = "ExitPromptError";
    readSpy.mockImplementation(() => {
      throw exitPromptError;
    });

    await expect(
      makeProgram().parseAsync(["node", "session-context", "opencode"])
    ).rejects.toThrow("prompt cancelled");

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("passes findProjectRoot result to reader", async () => {
    readSpy.mockReturnValue({ ok: true, data: {} });

    await makeProgram().parseAsync(["node", "session-context", "opencode"]);

    expect(readSpy).toHaveBeenCalledWith(tempDir, { maxEntries: undefined });
  });
});

describe("opencode list/show (CLI subprocess)", () => {
  // Subprocess tests avoid Bun's process-global mock.module state — this
  // file mocks the read helper for the in-process tests above, so the
  // nested subcommands are exercised against a real temp opencode DB in a
  // child process with XDG_DATA_HOME redirected.
  let tempHome: string;
  let projectDir: string;
  let env: Record<string, string>;

  beforeEach(() => {
    tempHome = realpathSync(mkdtempSync(join(tmpdir(), "archgate-oc-home-")));
    projectDir = join(tempHome, "project");
    mkdirSync(join(projectDir, ".archgate", "adrs"), { recursive: true });
    env = {
      HOME: tempHome,
      USERPROFILE: tempHome,
      XDG_DATA_HOME: join(tempHome, "xdg"),
    };
  });

  afterEach(() => {
    safeRmSync(tempHome);
  });

  /** Seed an opencode DB: parent session + sub-agent child, each with a message. */
  function seedOpencode(): void {
    mkdirSync(join(tempHome, "xdg", "opencode"), { recursive: true });
    const db = new Database(join(tempHome, "xdg", "opencode", "opencode.db"));
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, parent_id TEXT,
        directory TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
        time_created INTEGER NOT NULL DEFAULT 0, time_updated INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL DEFAULT 0, time_updated INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL DEFAULT 0, time_updated INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL DEFAULT '{}'
      );
    `);
    const addSession = (id: string, parent: string | null, t: number) => {
      db.run(
        "INSERT INTO session (id, parent_id, directory, title, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)",
        [
          id,
          parent,
          projectDir,
          id === "ses_parent" ? "main work" : "sub",
          t,
          t,
        ]
      );
      db.run(
        "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
        [`msg_${id}`, id, t + 1, JSON.stringify({ role: "user" })]
      );
      db.run(
        "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
        [
          `prt_${id}`,
          `msg_${id}`,
          id,
          t + 1,
          JSON.stringify({ type: "text", text: `content of ${id}` }),
        ]
      );
    };
    addSession("ses_parent", null, 1000);
    addSession("ses_child", "ses_parent", 2000);
    db.close();
  }

  test("list returns top-level sessions only", async () => {
    seedOpencode();

    const { exitCode, stdout } = await runCli(
      ["session-context", "opencode", "list"],
      projectDir,
      env
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      sessions: Array<{ id: string; title: string; updatedAt: string }>;
    };
    expect(parsed.sessions.map((s) => s.id)).toEqual(["ses_parent"]);
    expect(parsed.sessions[0]?.title).toBe("main work");
  });

  test("show reads a specific session; --root resolves to the ancestor", async () => {
    seedOpencode();

    const shown = await runCli(
      ["session-context", "opencode", "show", "ses_child"],
      projectDir,
      env
    );
    expect(shown.exitCode).toBe(0);
    expect((JSON.parse(shown.stdout) as { sessionId: string }).sessionId).toBe(
      "ses_child"
    );

    const rooted = await runCli(
      ["session-context", "opencode", "show", "ses_child", "--root"],
      projectDir,
      env
    );
    expect(rooted.exitCode).toBe(0);
    expect((JSON.parse(rooted.stdout) as { sessionId: string }).sessionId).toBe(
      "ses_parent"
    );
  });

  test("show with an unknown id exits 1", async () => {
    seedOpencode();

    const { exitCode, stderr } = await runCli(
      ["session-context", "opencode", "show", "ses_nope"],
      projectDir,
      env
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Session not found: ses_nope");
  });
});
