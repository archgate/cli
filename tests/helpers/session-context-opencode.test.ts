import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { readOpencodeSession } from "../../src/helpers/session-context-opencode";

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
    if (originalXdg === undefined) {
      delete Bun.env.XDG_DATA_HOME;
    } else {
      Bun.env.XDG_DATA_HOME = originalXdg;
    }
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
    timeUpdated?: number
  ): void {
    const now = timeUpdated ?? Date.now();
    db.run(
      "INSERT INTO session (id, directory, time_created, time_updated) VALUES (?, ?, ?, ?)",
      [sessionId, sessionDir, now, now]
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

    makeSession(
      db,
      sessionId1,
      projectRoot,
      [{ id: "msg_001", role: "user", content: "first session" }],
      1000
    );
    makeSession(
      db,
      sessionId2,
      projectRoot,
      [{ id: "msg_002", role: "user", content: "second session" }],
      2000
    );
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
    makeSession(db, sessionId, projectRoot, [
      { id: "msg_001", role: "user", content: "real" },
    ]);
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
    db.run(
      "INSERT INTO session (id, directory, time_created, time_updated) VALUES (?, ?, ?, ?)",
      [sessionId, projectRoot, now, now]
    );

    const roles = ["system", "tool", "user", "assistant"];
    const contents = ["system msg", "tool output", "visible", "also visible"];
    for (let i = 0; i < roles.length; i++) {
      const msgId = `msg_${String(i).padStart(3, "0")}`;
      db.run(
        "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
        [
          msgId,
          sessionId,
          now + i + 1,
          now + i + 1,
          JSON.stringify({ role: roles[i] }),
        ]
      );
      db.run(
        "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
        [
          `prt_${msgId}`,
          msgId,
          sessionId,
          now + i + 1,
          now + i + 1,
          JSON.stringify({ type: "text", text: contents[i] }),
        ]
      );
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

    db.run(
      "INSERT INTO session (id, directory, time_created, time_updated) VALUES (?, ?, ?, ?)",
      [sessionId, projectRoot, now, now]
    );

    // User message with a synthetic part and a real part
    const msgId = "msg_syn_001";
    db.run(
      "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
      [msgId, sessionId, now + 1, now + 1, JSON.stringify({ role: "user" })]
    );
    // Synthetic part (editor context)
    db.run(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        "prt_syn_001",
        msgId,
        sessionId,
        now + 1,
        now + 1,
        JSON.stringify({
          type: "text",
          text: "<system-reminder>Note: The user opened the file</system-reminder>",
          synthetic: true,
        }),
      ]
    );
    // Real part (user input)
    db.run(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        "prt_real_001",
        msgId,
        sessionId,
        now + 2,
        now + 2,
        JSON.stringify({ type: "text", text: "actual user question" }),
      ]
    );
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

  test("includes tool parts as [tool: name]", async () => {
    const db = createDb();
    const sessionId = `ses_${uniqueId}_tools`;
    const now = Date.now();

    db.run(
      "INSERT INTO session (id, directory, time_created, time_updated) VALUES (?, ?, ?, ?)",
      [sessionId, projectRoot, now, now]
    );

    const msgId = "msg_tool_001";
    db.run(
      "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
      [
        msgId,
        sessionId,
        now + 1,
        now + 1,
        JSON.stringify({ role: "assistant" }),
      ]
    );
    // Text part
    db.run(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        "prt_t1",
        msgId,
        sessionId,
        now + 1,
        now + 1,
        JSON.stringify({ type: "text", text: "Let me check that." }),
      ]
    );
    // Tool part
    db.run(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        "prt_t2",
        msgId,
        sessionId,
        now + 2,
        now + 2,
        JSON.stringify({ type: "tool", tool: "glob" }),
      ]
    );
    db.close();

    const result = await readOpencodeSession(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const preview = result.data.transcript[0]?.contentPreview ?? "";
    expect(preview).toContain("Let me check that.");
    expect(preview).toContain("[tool: glob]");
  });
});
