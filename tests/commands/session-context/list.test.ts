// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerListSessionContextCommand } from "../../../src/commands/session-context/list";
import { runCli } from "../../integration/cli-harness";
import { safeRmSync } from "../../test-utils";

// Behavior tests spawn the real CLI in a subprocess with HOME/USERPROFILE
// and XDG_DATA_HOME redirected into a temp dir. This avoids Bun's
// process-global mock.module state (the sibling command tests mock the
// session helpers, and those mocks leak across test files).

describe("registerListSessionContextCommand", () => {
  test("registers 'list' as a subcommand with --editor option", () => {
    const parent = new Command("session-context");
    registerListSessionContextCommand(parent);
    const sub = parent.commands.find((c) => c.name() === "list")!;
    expect(sub).toBeDefined();
    expect(sub.description()).toBeTruthy();
    const opt = sub.options.find((o) => o.long === "--editor");
    expect(opt).toBeDefined();
  });
});

describe("session-context list (CLI subprocess)", () => {
  let tempHome: string;
  let projectDir: string;
  let env: Record<string, string>;

  /** Encode a project path the way Claude Code names its projects dir. */
  function encodeClaude(p: string): string {
    return p
      .replaceAll("\\", "-")
      .replaceAll("/", "-")
      .replaceAll(":", "-")
      .replaceAll(".", "-");
  }

  beforeEach(() => {
    tempHome = realpathSync(mkdtempSync(join(tmpdir(), "archgate-list-home-")));
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

  /** Seed an opencode DB with one top-level and one child session. */
  function seedOpencode(): void {
    mkdirSync(join(tempHome, "xdg", "opencode"), { recursive: true });
    const db = new Database(join(tempHome, "xdg", "opencode", "opencode.db"));
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec(
      "CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', time_created INTEGER NOT NULL DEFAULT 0, time_updated INTEGER NOT NULL DEFAULT 0)"
    );
    db.run(
      "INSERT INTO session (id, parent_id, directory, title, time_updated) VALUES (?, ?, ?, ?, ?)",
      ["ses_top", null, projectDir, "main work", 2000]
    );
    db.run(
      "INSERT INTO session (id, parent_id, directory, title, time_updated) VALUES (?, ?, ?, ?, ?)",
      ["ses_child", "ses_top", projectDir, "sub-agent", 3000]
    );
    db.close();
  }

  /** Seed a Claude Code session file for the project. */
  function seedClaudeCode(id: string): void {
    const dir = join(tempHome, ".claude", "projects", encodeClaude(projectDir));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${id}.jsonl`),
      JSON.stringify({ type: "user", message: { role: "user", content: "hi" } })
    );
  }

  test("--editor opencode lists top-level sessions only", async () => {
    seedOpencode();

    const { exitCode, stdout } = await runCli(
      ["session-context", "list", "--editor", "opencode"],
      projectDir,
      env
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      sessions: Array<{ id: string; title: string; updatedAt: string }>;
    };
    expect(parsed.sessions.map((s) => s.id)).toEqual(["ses_top"]);
    expect(parsed.sessions[0]?.title).toBe("main work");
    expect(Date.parse(parsed.sessions[0]?.updatedAt ?? "")).not.toBeNaN();
  });

  test("--editor with an absent store exits 1 with error", async () => {
    const { exitCode, stderr } = await runCli(
      ["session-context", "list", "--editor", "copilot"],
      projectDir,
      env
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Copilot");
  });

  test("without --editor aggregates all editors, folding errors in", async () => {
    seedClaudeCode("abc123");
    seedOpencode();

    const { exitCode, stdout } = await runCli(
      ["session-context", "list"],
      projectDir,
      env
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      editors: Record<
        string,
        { sessions?: Array<{ id: string }>; error?: string }
      >;
    };
    expect(Object.keys(parsed.editors).sort()).toEqual([
      "claude-code",
      "copilot",
      "cursor",
      "opencode",
    ]);
    expect(parsed.editors["claude-code"]?.sessions?.[0]?.id).toBe("abc123");
    expect(parsed.editors.opencode?.sessions?.[0]?.id).toBe("ses_top");
    // Stores that don't exist report their error instead of failing the command
    expect(parsed.editors.cursor?.error).toBeTruthy();
    expect(parsed.editors.copilot?.error).toBeTruthy();
  });

  test("rejects an unknown --editor value", async () => {
    const { exitCode, stderr } = await runCli(
      ["session-context", "list", "--editor", "vim"],
      projectDir,
      env
    );

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Allowed choices");
  });
});
