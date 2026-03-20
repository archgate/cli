import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readCursorSession } from "../../src/helpers/session-context";

// This file covers readCursorSession happy-path tests that require a temp home dir.
// Error cases for readCursorSession live in session-context.test.ts.

describe("readCursorSession (with temp home dir)", () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  // encodeProjectPath("/myproject") = "-myproject"
  const projectRoot = "/myproject";
  const encodedProject = "-myproject";

  beforeEach(() => {
    originalHome = process.env["HOME"];
    originalUserProfile = process.env["USERPROFILE"];
    tmpHome = mkdtempSync(join(tmpdir(), "archgate-test-cursor-"));
    // node:os homedir() reads USERPROFILE on Windows and HOME on Unix
    process.env["HOME"] = tmpHome;
    process.env["USERPROFILE"] = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env["HOME"];
    } else {
      process.env["HOME"] = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env["USERPROFILE"];
    } else {
      process.env["USERPROFILE"] = originalUserProfile;
    }
    rmSync(tmpHome, { recursive: true, force: true });
  });

  function makeTranscriptsDir(): string {
    const transcriptsDir = join(
      tmpHome,
      ".cursor",
      "projects",
      encodedProject,
      "agent-transcripts"
    );
    mkdirSync(transcriptsDir, { recursive: true });
    return transcriptsDir;
  }

  function makeSession(
    transcriptsDir: string,
    sessionId: string,
    lines: string[]
  ): void {
    const sessionDir = join(transcriptsDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, `${sessionId}.jsonl`), lines.join("\n"));
  }

  test("returns data for most recent session", async () => {
    const transcriptsDir = makeTranscriptsDir();
    makeSession(transcriptsDir, "session-abc", [
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
    const transcriptsDir = makeTranscriptsDir();
    makeSession(transcriptsDir, "session-first", [
      JSON.stringify({
        role: "user",
        message: { role: "user", content: "first session" },
      }),
    ]);
    makeSession(transcriptsDir, "session-second", [
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
    const transcriptsDir = makeTranscriptsDir();
    makeSession(transcriptsDir, "session-real", [
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
    // Create transcripts dir but leave it empty
    makeTranscriptsDir();

    const result = await readCursorSession(projectRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No session directories found");
    }
  });

  test("handles malformed JSONL", async () => {
    const transcriptsDir = makeTranscriptsDir();
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
    const transcriptsDir = makeTranscriptsDir();
    makeSession(transcriptsDir, "session-roles", [
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
    const transcriptsDir = makeTranscriptsDir();
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
    makeSession(transcriptsDir, "session-limit", lines);

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
    const transcriptsDir = makeTranscriptsDir();
    // Put a plain file in the transcripts dir — it should be skipped
    writeFileSync(join(transcriptsDir, "stray-file.txt"), "noise");
    makeSession(transcriptsDir, "session-good", [
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
