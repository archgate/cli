import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { readCursorSession } from "../../src/helpers/session-context";

// This file covers readCursorSession happy-path tests.
// Error cases for readCursorSession live in session-context.test.ts.

describe("readCursorSession", () => {
  // Use a unique encoded project name under the *real* homedir so that
  // homedir() caching on Linux doesn't break the tests.
  const uniqueId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const projectRoot = `/__archgate_cursor_test_${uniqueId}`;
  const encodedProject = projectRoot
    .replaceAll("/", "-")
    .replaceAll("\\", "-")
    .replaceAll(":", "-")
    .replaceAll(".", "-");
  let transcriptsDir: string;

  beforeEach(() => {
    transcriptsDir = join(
      homedir(),
      ".cursor",
      "projects",
      encodedProject,
      "agent-transcripts"
    );
    mkdirSync(transcriptsDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up from .cursor/projects/<encoded> level
    const projectDir = join(homedir(), ".cursor", "projects", encodedProject);
    rmSync(projectDir, { recursive: true, force: true });
  });

  function makeSession(sessionId: string, lines: string[]): void {
    const sessionDir = join(transcriptsDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, `${sessionId}.jsonl`), lines.join("\n"));
  }

  test("returns data for most recent session", async () => {
    makeSession("session-abc", [
      JSON.stringify({
        role: "user",
        message: { role: "user", content: "hello" },
      }),
      JSON.stringify({
        role: "assistant",
        message: { role: "assistant", content: "hi" },
      }),
    ]);

    const result = await readCursorSession(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.sessionId).toBe("session-abc");
    expect(result.data.sessionFile).toBe("session-abc.jsonl");
    expect(result.data.totalEntries).toBe(2);
    expect(result.data.relevantEntries).toBe(2);
    expect(result.data.transcript[0]).toEqual({
      role: "user",
      contentPreview: "hello",
    });
    expect(result.data.transcript[1]).toEqual({
      role: "assistant",
      contentPreview: "hi",
    });
  });

  test("finds session by sessionId", async () => {
    makeSession("session-first", [
      JSON.stringify({
        role: "user",
        message: { role: "user", content: "first session" },
      }),
    ]);
    makeSession("session-second", [
      JSON.stringify({
        role: "user",
        message: { role: "user", content: "second session" },
      }),
    ]);

    const result = await readCursorSession(projectRoot, {
      sessionId: "session-first",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.sessionId).toBe("session-first");
    expect(result.data.transcript[0]?.contentPreview).toBe("first session");
  });

  test("returns error when sessionId not found (with available list)", async () => {
    makeSession("session-real", [
      JSON.stringify({
        role: "user",
        message: { role: "user", content: "real" },
      }),
    ]);

    const result = await readCursorSession(projectRoot, {
      sessionId: "session-fake",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("session-fake");
      expect(result.available).toContain("session-real");
    }
  });

  test("returns error when no session directories exist", async () => {
    // transcriptsDir exists but is empty
    const result = await readCursorSession(projectRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No session directories found");
    }
  });

  test("handles malformed JSONL", async () => {
    const sessionId = "session-bad";
    const sessionDir = join(transcriptsDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, `${sessionId}.jsonl`),
      "}{not valid json at all"
    );

    const result = await readCursorSession(projectRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Failed to read session file");
    }
  });

  test("filters to user/assistant roles only", async () => {
    makeSession("session-roles", [
      JSON.stringify({
        role: "system",
        message: { role: "system", content: "system msg" },
      }),
      JSON.stringify({
        role: "tool",
        message: { role: "tool", content: "tool output" },
      }),
      JSON.stringify({
        role: "user",
        message: { role: "user", content: "visible" },
      }),
      JSON.stringify({
        role: "assistant",
        message: { role: "assistant", content: "also visible" },
      }),
    ]);

    const result = await readCursorSession(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.totalEntries).toBe(4);
    expect(result.data.relevantEntries).toBe(2);
    expect(result.data.transcript[0]?.contentPreview).toBe("visible");
    expect(result.data.transcript[1]?.contentPreview).toBe("also visible");
  });

  test("respects maxEntries — keeps last N relevant entries", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 8; i++) {
      lines.push(
        JSON.stringify({
          role: i % 2 === 0 ? "user" : "assistant",
          message: {
            role: i % 2 === 0 ? "user" : "assistant",
            content: `msg ${i}`,
          },
        })
      );
    }
    makeSession("session-limit", lines);

    const result = await readCursorSession(projectRoot, { maxEntries: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.relevantEntries).toBe(8);
    expect(result.data.transcript).toHaveLength(2);
    // slice(-2) keeps last 2 — messages 6 and 7
    expect(result.data.transcript[0]?.contentPreview).toBe("msg 6");
    expect(result.data.transcript[1]?.contentPreview).toBe("msg 7");
  });

  test("ignores non-directory entries in transcripts dir", async () => {
    // Put a plain file in the transcripts dir — it should be skipped
    writeFileSync(join(transcriptsDir, "stray-file.txt"), "noise");
    makeSession("session-good", [
      JSON.stringify({
        role: "user",
        message: { role: "user", content: "works" },
      }),
    ]);

    const result = await readCursorSession(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.sessionId).toBe("session-good");
  });
});
