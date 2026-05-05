import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { readOpencodeSession } from "../../src/helpers/session-context-opencode";

// This file covers readOpencodeSession happy-path and error-case tests.

describe("readOpencodeSession", () => {
  const uniqueId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const projectRoot = resolve(`/__archgate_opencode_test_${uniqueId}`);
  // Use a temp storage dir under homedir to avoid polluting real opencode data
  const projectHash = `proj_${uniqueId}`;
  let storageDir: string;
  let sessionBaseDir: string;
  let messageBaseDir: string;

  beforeEach(() => {
    storageDir = join(homedir(), ".local", "share", "opencode", "storage");
    sessionBaseDir = join(storageDir, "session");
    messageBaseDir = join(storageDir, "message");
    mkdirSync(sessionBaseDir, { recursive: true });
    mkdirSync(messageBaseDir, { recursive: true });
  });

  afterEach(() => {
    for (const dir of createdDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    createdDirs.length = 0;
  });

  const createdDirs: string[] = [];

  function makeSession(
    sessionId: string,
    sessionPath: string,
    messages?: Array<{ id: string; role: string; content: string }>
  ): void {
    // Create session metadata file
    const sessionDir = join(sessionBaseDir, projectHash);
    mkdirSync(sessionDir, { recursive: true });
    createdDirs.push(sessionDir);

    const sessionMeta = {
      id: sessionId,
      title: `Test session ${sessionId}`,
      path: sessionPath,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    writeFileSync(
      join(sessionDir, `${sessionId}.json`),
      JSON.stringify(sessionMeta)
    );

    // Create message files
    if (messages) {
      const msgDir = join(messageBaseDir, sessionId);
      mkdirSync(msgDir, { recursive: true });
      createdDirs.push(msgDir);

      for (const msg of messages) {
        const msgData = {
          id: msg.id,
          role: msg.role,
          content: msg.content,
          session_id: sessionId,
          created_at: new Date().toISOString(),
        };
        writeFileSync(join(msgDir, `${msg.id}.json`), JSON.stringify(msgData));
      }
    }
  }

  test("returns data for most recent session matching project", async () => {
    const sessionId = `ses_${uniqueId}_1`;
    makeSession(sessionId, projectRoot, [
      { id: "msg_001", role: "user", content: "hello opencode" },
      { id: "msg_002", role: "assistant", content: "hi there" },
    ]);

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
    const sessionId1 = `ses_${uniqueId}_first`;
    const sessionId2 = `ses_${uniqueId}_second`;

    makeSession(sessionId1, projectRoot, [
      { id: "msg_001", role: "user", content: "first session" },
    ]);
    makeSession(sessionId2, projectRoot, [
      { id: "msg_001", role: "user", content: "second session" },
    ]);

    const result = await readOpencodeSession(projectRoot, {
      sessionId: sessionId1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.sessionId).toBe(sessionId1);
    expect(result.data.transcript[0]?.contentPreview).toBe("first session");
  });

  test("returns error when sessionId not found (with available list)", async () => {
    const sessionId = `ses_${uniqueId}_real`;
    makeSession(sessionId, projectRoot, [
      { id: "msg_001", role: "user", content: "real" },
    ]);

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
    const sessionId = `ses_${uniqueId}_roles`;
    makeSession(sessionId, projectRoot, [
      { id: "msg_001", role: "system", content: "system msg" },
      { id: "msg_002", role: "tool", content: "tool output" },
      { id: "msg_003", role: "user", content: "visible" },
      { id: "msg_004", role: "assistant", content: "also visible" },
    ]);

    const result = await readOpencodeSession(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.totalEntries).toBe(4);
    expect(result.data.relevantEntries).toBe(2);
    expect(result.data.transcript[0]?.contentPreview).toBe("visible");
    expect(result.data.transcript[1]?.contentPreview).toBe("also visible");
  });

  test("returns error when no sessions match the project", async () => {
    const sessionId = `ses_${uniqueId}_other`;
    makeSession(sessionId, "/some/other/project", [
      { id: "msg_001", role: "user", content: "wrong project" },
    ]);

    const result = await readOpencodeSession(projectRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(
        "No opencode sessions found for this project"
      );
    }
  });

  test("returns error when session has no message directory", async () => {
    const sessionId = `ses_${uniqueId}_nomsg`;
    // Create session metadata but no message directory
    const sessionDir = join(sessionBaseDir, projectHash);
    mkdirSync(sessionDir, { recursive: true });
    createdDirs.push(sessionDir);

    const sessionMeta = {
      id: sessionId,
      path: projectRoot,
      updated_at: new Date().toISOString(),
    };
    writeFileSync(
      join(sessionDir, `${sessionId}.json`),
      JSON.stringify(sessionMeta)
    );

    const result = await readOpencodeSession(projectRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no messages");
    }
  });

  test("respects maxEntries — keeps last N relevant entries", async () => {
    const sessionId = `ses_${uniqueId}_limit`;
    const messages: Array<{ id: string; role: string; content: string }> = [];
    for (let i = 0; i < 8; i++) {
      messages.push({
        id: `msg_${String(i).padStart(3, "0")}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `msg ${i}`,
      });
    }
    makeSession(sessionId, projectRoot, messages);

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
    const sessionId = `ses_${uniqueId}_truncate`;
    makeSession(sessionId, projectRoot, [
      { id: "msg_001", role: "user", content: "x".repeat(600) },
    ]);

    const result = await readOpencodeSession(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const preview = result.data.transcript[0]?.contentPreview ?? "";
    expect(preview).toHaveLength(503); // 500 chars + "..."
    expect(preview.endsWith("...")).toBe(true);
  });

  test("returns error when storage directory does not exist", async () => {
    // readOpencodeSession should handle missing storage gracefully
    const result = await readOpencodeSession(
      "/nonexistent/path/that/wont/match"
    );
    expect(result.ok).toBe(false);
  });
});
