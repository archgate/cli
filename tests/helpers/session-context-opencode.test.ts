// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  listOpencodeSessions,
  readOpencodeSession,
} from "../../src/helpers/session-context-opencode";
import { restoreEnv } from "../test-utils";

/**
 * Tests for readOpencodeSession — reads session data from
 * opencode's SQLite database.
 */
describe("readOpencodeSession", () => {
  const uniqueId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const projectRoot = resolve(`/__archgate_opencode_test_${uniqueId}`);
  let tempDir: string;
  let dbPath: string;
  let originalXdg: string | undefined;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `archgate-opencode-test-${uniqueId}-${Date.now()}`
    );
    mkdirSync(join(tempDir, "opencode"), { recursive: true });
    dbPath = join(tempDir, "opencode", "opencode.db");

    // Point opencodeDbPath() to our temp directory
    originalXdg = Bun.env.XDG_DATA_HOME;
    Bun.env.XDG_DATA_HOME = tempDir;
  });

  afterEach(() => {
    restoreEnv("XDG_DATA_HOME", originalXdg);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // On Windows, SQLite file handles may persist briefly after close.
      // Temp dirs use unique names, so leftover files don't affect other tests.
    }
  });

  /** Create the opencode database schema. */
  function createDb(): Database {
    const db = new Database(dbPath);
    // Use DELETE journal mode to avoid WAL/SHM files that lock on Windows
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT '',
        parent_id TEXT,
        slug TEXT NOT NULL DEFAULT '',
        directory TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
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

  /** Insert a session with messages and text parts. */
  function makeSession(
    db: Database,
    sessionId: string,
    sessionDir: string,
    messages?: Array<{ id: string; role: string; content: string }>,
    timeUpdated?: number,
    parentId?: string
  ): void {
    const now = timeUpdated ?? Date.now();
    db.run(
      "INSERT INTO session (id, parent_id, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)",
      [sessionId, parentId ?? null, sessionDir, now, now]
    );

    if (!messages) return;

    let msgTime = now;
    for (const msg of messages) {
      msgTime += 1;
      db.run(
        "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
        [
          msg.id,
          sessionId,
          msgTime,
          msgTime,
          JSON.stringify({ role: msg.role }),
        ]
      );
      db.run(
        "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
        [
          `prt_${msg.id}`,
          msg.id,
          sessionId,
          msgTime,
          msgTime,
          JSON.stringify({ type: "text", text: msg.content }),
        ]
      );
    }
  }

  /** Insert a session under `projectRoot` with a single user message. */
  function makeSimpleSession(
    db: Database,
    id: string,
    content: string,
    timeUpdated: number,
    parentId?: string
  ): void {
    makeSession(
      db,
      id,
      projectRoot,
      [{ id: `msg_${id}`, role: "user", content }],
      timeUpdated,
      parentId
    );
  }

  /** Insert a raw message row with the given role. */
  function insertMessage(
    db: Database,
    id: string,
    sessionId: string,
    t: number,
    role: string
  ): void {
    db.run(
      "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
      [id, sessionId, t, t, JSON.stringify({ role })]
    );
  }

  /** Insert a raw part row with arbitrary JSON data. */
  function insertPart(
    db: Database,
    id: string,
    messageId: string,
    sessionId: string,
    t: number,
    data: Record<string, unknown>
  ): void {
    db.run(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [id, messageId, sessionId, t, t, JSON.stringify(data)]
    );
  }

  test("returns data for most recent session matching project", async () => {
    const db = createDb();
    const sessionId = `ses_${uniqueId}_1`;
    makeSession(db, sessionId, projectRoot, [
      { id: "msg_001", role: "user", content: "hello opencode" },
      { id: "msg_002", role: "assistant", content: "hi there" },
    ]);
    db.close();

    const result = await readOpencodeSession(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.sessionId).toBe(sessionId);
    expect(result.data.totalEntries).toBe(2);
    expect(result.data.relevantEntries).toBe(2);
    expect(result.data.transcript[0]).toEqual({
      role: "user",
      contentPreview: "hello opencode",
    });
    expect(result.data.transcript[1]).toEqual({
      role: "assistant",
      contentPreview: "hi there",
    });
  });

  test("finds session by sessionId", async () => {
    const db = createDb();
    const sessionId1 = `ses_${uniqueId}_first`;
    const sessionId2 = `ses_${uniqueId}_second`;

    makeSimpleSession(db, sessionId1, "first session", 1000);
    makeSimpleSession(db, sessionId2, "second session", 2000);
    db.close();

    const result = await readOpencodeSession(projectRoot, {
      sessionId: sessionId1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.sessionId).toBe(sessionId1);
    expect(result.data.transcript[0]?.contentPreview).toBe("first session");
  });

  test("returns error when sessionId not found (with available list)", async () => {
    const db = createDb();
    const sessionId = `ses_${uniqueId}_real`;
    makeSimpleSession(db, sessionId, "real", 1000);
    db.close();

    const result = await readOpencodeSession(projectRoot, {
      sessionId: "nonexistent-id",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("nonexistent-id");
      expect(result.available).toContain(sessionId);
    }
  });

  test("filters to user/assistant roles only", async () => {
    const db = createDb();
    const sessionId = `ses_${uniqueId}_roles`;

    // Insert messages with various roles — system and tool should be filtered out
    const now = Date.now();
    makeSession(db, sessionId, projectRoot, undefined, now);

    const roles = ["system", "tool", "user", "assistant"];
    const contents = ["system msg", "tool output", "visible", "also visible"];
    for (let i = 0; i < roles.length; i++) {
      const msgId = `msg_${String(i).padStart(3, "0")}`;
      insertMessage(db, msgId, sessionId, now + i + 1, roles[i] ?? "");
      insertPart(db, `prt_${msgId}`, msgId, sessionId, now + i + 1, {
        type: "text",
        text: contents[i],
      });
    }
    db.close();

    const result = await readOpencodeSession(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.totalEntries).toBe(4);
    expect(result.data.relevantEntries).toBe(2);
    expect(result.data.transcript[0]?.contentPreview).toBe("visible");
    expect(result.data.transcript[1]?.contentPreview).toBe("also visible");
  });

  test("returns error when no sessions match the project", async () => {
    const db = createDb();
    const sessionId = `ses_${uniqueId}_other`;
    makeSession(db, sessionId, "/some/other/project", [
      { id: "msg_001", role: "user", content: "wrong project" },
    ]);
    db.close();

    const result = await readOpencodeSession(projectRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(
        "No opencode sessions found for this project"
      );
    }
  });

  test("returns error when session has no messages", async () => {
    const db = createDb();
    const sessionId = `ses_${uniqueId}_nomsg`;
    // Create session but no messages
    makeSession(db, sessionId, projectRoot);
    db.close();

    const result = await readOpencodeSession(projectRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no messages");
    }
  });

  test("respects maxEntries — keeps last N relevant entries", async () => {
    const db = createDb();
    const sessionId = `ses_${uniqueId}_limit`;

    const msgs: Array<{ id: string; role: string; content: string }> = [];
    for (let i = 0; i < 8; i++) {
      msgs.push({
        id: `msg_${String(i).padStart(3, "0")}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `msg ${i}`,
      });
    }
    makeSession(db, sessionId, projectRoot, msgs);
    db.close();

    const result = await readOpencodeSession(projectRoot, { maxEntries: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.relevantEntries).toBe(8);
    expect(result.data.transcript).toHaveLength(2);
    // slice(-2) keeps last 2 — messages 6 and 7
    expect(result.data.transcript[0]?.contentPreview).toBe("msg 6");
    expect(result.data.transcript[1]?.contentPreview).toBe("msg 7");
  });

  test("truncates string content preview to 500 chars", async () => {
    const db = createDb();
    const sessionId = `ses_${uniqueId}_truncate`;
    makeSession(db, sessionId, projectRoot, [
      { id: "msg_001", role: "user", content: "x".repeat(600) },
    ]);
    db.close();

    const result = await readOpencodeSession(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const preview = result.data.transcript[0]?.contentPreview ?? "";
    expect(preview).toHaveLength(503); // 500 chars + "..."
    expect(preview.endsWith("...")).toBe(true);
  });

  test("returns error when database does not exist", async () => {
    // Point to a non-existent directory
    Bun.env.XDG_DATA_HOME = join(tempDir, "nonexistent");

    const result = await readOpencodeSession(projectRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No opencode database found");
    }
  });

  test("skips synthetic parts", async () => {
    const db = createDb();
    const sessionId = `ses_${uniqueId}_synthetic`;
    const now = Date.now();
    makeSession(db, sessionId, projectRoot, undefined, now);

    // User message with a synthetic part (editor context) and a real part
    insertMessage(db, "msg_syn", sessionId, now + 1, "user");
    insertPart(db, "prt_syn", "msg_syn", sessionId, now + 1, {
      type: "text",
      text: "<system-reminder>Note: The user opened the file</system-reminder>",
      synthetic: true,
    });
    insertPart(db, "prt_real", "msg_syn", sessionId, now + 2, {
      type: "text",
      text: "actual user question",
    });
    db.close();

    const result = await readOpencodeSession(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.transcript[0]?.contentPreview).toBe(
      "actual user question"
    );
    // The synthetic part should not appear
    expect(result.data.transcript[0]?.contentPreview).not.toContain(
      "system-reminder"
    );
  });

  test("excludes sub-agent child sessions from recency selection", async () => {
    const db = createDb();
    makeSimpleSession(db, "ses_parent", "parent question", 1000);
    // Child session is newer — it must NOT shadow the parent session
    makeSimpleSession(db, "ses_sub", "sub-agent init", 2000, "ses_parent");
    db.close();

    const result = await readOpencodeSession(projectRoot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sessionId).toBe("ses_parent");
      expect(result.data.transcript[0]?.contentPreview).toBe("parent question");
    }
  });

  test("sessionId can read a sub-agent child session explicitly", async () => {
    const db = createDb();
    makeSimpleSession(db, "ses_parent", "parent question", 1000);
    makeSimpleSession(db, "ses_sub", "sub-agent init", 2000, "ses_parent");
    db.close();

    const result = await readOpencodeSession(projectRoot, {
      sessionId: "ses_sub",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sessionId).toBe("ses_sub");
      expect(result.data.transcript[0]?.contentPreview).toBe("sub-agent init");
    }
  });

  test("list returns top-level sessions only, most recent first", () => {
    const db = createDb();
    makeSimpleSession(db, "ses_older", "older top-level", 1000);
    makeSimpleSession(db, "ses_newer", "newer top-level", 2000);
    // Child session between the two — must not appear in the list
    makeSimpleSession(db, "ses_child", "child", 1500, "ses_older");
    db.close();

    const result = listOpencodeSessions(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.sessions.map((s) => s.id)).toEqual([
      "ses_newer",
      "ses_older",
    ]);
    expect(Date.parse(result.data.sessions[0]?.updatedAt ?? "")).not.toBeNaN();
  });

  test("root resolves to the top-level ancestor session", async () => {
    const db = createDb();
    makeSimpleSession(db, "ses_parent", "parent question", 1000);
    makeSimpleSession(db, "ses_sub", "sub-agent init", 2000, "ses_parent");
    // Grandchild — root must walk the whole parent_id chain
    makeSimpleSession(db, "ses_grand", "grandchild", 3000, "ses_sub");
    db.close();

    const viaChild = await readOpencodeSession(projectRoot, {
      sessionId: "ses_grand",
      root: true,
    });
    expect(viaChild.ok).toBe(true);
    if (viaChild.ok) expect(viaChild.data.sessionId).toBe("ses_parent");

    const noId = await readOpencodeSession(projectRoot, { root: true });
    expect(noId.ok).toBe(true);
    if (noId.ok) expect(noId.data.sessionId).toBe("ses_parent");
  });

  test("selects the true parent when sibling sub-agents fan out and are more recent", async () => {
    // Real-world fan-out reproduced from a live incident: one parent session
    // spawns several sibling sub-agent sessions against the same directory
    // (e.g. the reviewer skill's parallel domain reviews). Every sibling
    // sorts ahead of the parent by recency; none of them may shadow it.
    // The old recency-based `--skip 1` landed on whichever sibling sat
    // second in recency order instead of the parent.
    const db = createDb();
    makeSimpleSession(db, "ses_parent", "parent development session", 1000);
    makeSimpleSession(db, "ses_sib_a", "domain review a", 2000, "ses_parent");
    makeSimpleSession(db, "ses_sib_b", "domain review b", 3000, "ses_parent");
    makeSimpleSession(db, "ses_sib_c", "domain review c", 4000, "ses_parent");
    makeSimpleSession(db, "ses_sib_d", "domain review d", 5000, "ses_parent");
    db.close();

    // The list shows only the parent — no sibling can shadow it.
    const listed = listOpencodeSessions(projectRoot);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.data.sessions.map((s) => s.id)).toEqual(["ses_parent"]);
    }

    // Default selection and explicit root both resolve to the parent.
    const byDefault = await readOpencodeSession(projectRoot);
    expect(byDefault.ok).toBe(true);
    if (byDefault.ok) expect(byDefault.data.sessionId).toBe("ses_parent");

    const rooted = await readOpencodeSession(projectRoot, { root: true });
    expect(rooted.ok).toBe(true);
    if (rooted.ok) expect(rooted.data.sessionId).toBe("ses_parent");
  });

  test("returns error when only child sessions match the project", async () => {
    const db = createDb();
    // Parent lives in a different directory; only the child matches here
    makeSession(db, "ses_parent", "/some/other/project", [
      { id: "msg_p", role: "user", content: "elsewhere" },
    ]);
    makeSimpleSession(db, "ses_child", "child", 2000, "ses_parent");
    db.close();

    const result = await readOpencodeSession(projectRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(
        "No top-level opencode session found for this project"
      );
      expect(result.available).toEqual(["ses_child"]);
    }
  });

  test("includes tool parts as [tool: name]", async () => {
    const db = createDb();
    const sessionId = `ses_${uniqueId}_tools`;
    const now = Date.now();
    makeSession(db, sessionId, projectRoot, undefined, now);

    insertMessage(db, "msg_tool", sessionId, now + 1, "assistant");
    insertPart(db, "prt_t1", "msg_tool", sessionId, now + 1, {
      type: "text",
      text: "Let me check that.",
    });
    insertPart(db, "prt_t2", "msg_tool", sessionId, now + 2, {
      type: "tool",
      tool: "glob",
    });
    db.close();

    const result = await readOpencodeSession(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const preview = result.data.transcript[0]?.contentPreview ?? "";
    expect(preview).toContain("Let me check that.");
    expect(preview).toContain("[tool: glob]");
  });
});
