// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerShowSessionContextCommand } from "../../../src/commands/session-context/show";
import { runCli } from "../../integration/cli-harness";
import { safeRmSync } from "../../test-utils";

// Behavior tests spawn the real CLI in a subprocess with HOME/USERPROFILE
// and XDG_DATA_HOME redirected into a temp dir. This avoids Bun's
// process-global mock.module state (the sibling command tests mock the
// session helpers, and those mocks leak across test files).

describe("registerShowSessionContextCommand", () => {
  test("registers 'show' with --editor, --max-entries, and --root", () => {
    const parent = new Command("session-context");
    registerShowSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "show")!;
    expect(sub).toBeDefined();
    expect(sub.description()).toBeTruthy();
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--editor");
    expect(opts).toContain("--max-entries");
    expect(opts).toContain("--root");
  });
});

describe("session-context show (CLI subprocess)", () => {
  let tempHome: string;
  let projectDir: string;
  let env: Record<string, string>;

  beforeEach(() => {
    tempHome = realpathSync(mkdtempSync(join(tmpdir(), "archgate-show-home-")));
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
        "INSERT INTO session (id, parent_id, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)",
        [id, parent, projectDir, t, t]
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

  test("reads a specific opencode session by positional id", async () => {
    seedOpencode();

    const { exitCode, stdout } = await runCli(
      ["session-context", "show", "ses_child", "--editor", "opencode"],
      projectDir,
      env
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      sessionId: string;
      transcript: Array<{ contentPreview: string }>;
    };
    expect(parsed.sessionId).toBe("ses_child");
    expect(parsed.transcript[0]?.contentPreview).toBe("content of ses_child");
  });

  test("--root resolves an opencode child session to its ancestor", async () => {
    seedOpencode();

    const { exitCode, stdout } = await runCli(
      [
        "session-context",
        "show",
        "ses_child",
        "--editor",
        "opencode",
        "--root",
      ],
      projectDir,
      env
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { sessionId: string };
    expect(parsed.sessionId).toBe("ses_parent");
  });

  test("--root with a non-opencode editor exits 1", async () => {
    const { exitCode, stderr } = await runCli(
      ["session-context", "show", "abc", "--editor", "claude-code", "--root"],
      projectDir,
      env
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("only supported with --editor opencode");
  });

  test("unknown session id exits 1 with error", async () => {
    seedOpencode();

    const { exitCode, stderr } = await runCli(
      ["session-context", "show", "ses_nope", "--editor", "opencode"],
      projectDir,
      env
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Session not found: ses_nope");
  });

  test("missing --editor is rejected", async () => {
    const { exitCode, stderr } = await runCli(
      ["session-context", "show", "abc"],
      projectDir,
      env
    );

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--editor");
  });
});
