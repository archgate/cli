// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { readOpencodeSession } from "../../src/helpers/session-context-opencode";

/**
 * Tests for readOpencodeSession's `root` option — resolving the true
 * top-level session via `session.parent_id` instead of guessing by recency.
 *
 * Split from session-context-opencode.test.ts to stay under oxlint's
 * max-lines limit.
 */
describe("readOpencodeSession — root option", () => {
  const uniqueId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const projectRoot = resolve(`/__archgate_opencode_root_test_${uniqueId}`);
  let tempDir: string;
  let dbPath: string;
  let originalXdg: string | undefined;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `archgate-opencode-root-test-${uniqueId}-${Date.now()}`
    );
    mkdirSync(join(tempDir, "opencode"), { recursive: true });
    dbPath = join(tempDir, "opencode", "opencode.db");
    originalXdg = Bun.env.XDG_DATA_HOME;
    Bun.env.XDG_DATA_HOME = tempDir;
  });

  afterEach(() => {
    if (originalXdg === undefined) {
      delete Bun.env.XDG_DATA_HOME;
    } else {
      Bun.env.XDG_DATA_HOME = originalXdg;
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // On Windows, SQLite file handles may persist briefly after close.
    }
  });

  function createDb(): Database {
    const db = new Database(dbPath);
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT '',
        parent_id TEXT,
        directory TEXT NOT NULL DEFAULT '',
        time_created INTEGER NOT NULL DEFAULT 0,
        time_updated INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL DEFAULT 0,
        time_updated INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL DEFAULT 0,
        time_updated INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL DEFAULT '{}'
      );
    `);
    return db;
  }

  /** Insert a session with a single user message, optionally as a child. */
  function makeSession(
    db: Database,
    sessionId: string,
    timeUpdated: number,
    parentId: string | null = null
  ): void {
    db.run(
      "INSERT INTO session (id, directory, parent_id, time_created, time_updated) VALUES (?, ?, ?, ?, ?)",
      [sessionId, projectRoot, parentId, timeUpdated, timeUpdated]
    );
    const msgId = `msg_${sessionId}`;
    db.run(
      "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
      [msgId, sessionId, timeUpdated + 1, timeUpdated + 1, '{"role":"user"}']
    );
    db.run(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        `prt_${msgId}`,
        msgId,
        sessionId,
        timeUpdated + 1,
        timeUpdated + 1,
        JSON.stringify({ type: "text", text: sessionId }),
      ]
    );
  }

  test("root reads the true parent even when sibling sub-agents are more recent", async () => {
    // Real-world fan-out: one parent spawns sibling sub-agent sessions
    // against the same directory. Plain --skip 1 lands on whichever sibling
    // sits second in recency order, not the parent — --root fixes this by
    // filtering to parent_id IS NULL first.
    const db = createDb();
    makeSession(db, "ses_parent", 1000);
    makeSession(db, "ses_sibling_a", 3000, "ses_parent");
    makeSession(db, "ses_sibling_b", 2000, "ses_parent");
    db.close();

    const skipped = await readOpencodeSession(projectRoot, { skip: 1 });
    if (skipped.ok) expect(skipped.data.sessionId).toBe("ses_sibling_b");

    const rooted = await readOpencodeSession(projectRoot, { root: true });
    expect(rooted.ok).toBe(true);
    if (rooted.ok) expect(rooted.data.sessionId).toBe("ses_parent");
  });

  test("root combined with skip selects among root sessions only", async () => {
    const db = createDb();
    makeSession(db, "ses_root_old", 1000);
    makeSession(db, "ses_child", 1500, "ses_root_old");
    makeSession(db, "ses_root_new", 2000);
    db.close();

    // The intervening child is excluded from the root-only list, so skip 1
    // lands on the older root session, not the child.
    const result = await readOpencodeSession(projectRoot, {
      root: true,
      skip: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.sessionId).toBe("ses_root_old");
  });

  test("root returns error when no root sessions are available", async () => {
    const db = createDb();
    makeSession(db, "ses_orphan_child", 1000, "ses_missing_parent");
    db.close();

    const result = await readOpencodeSession(projectRoot, { root: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("root session(s)");
      expect(result.error).toContain("--skip 0 requested");
    }
  });
});
