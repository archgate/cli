// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
  type Mock,
} from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import {
  encodeProjectPath,
  listCursorSessions,
  readCursorSession,
} from "../../src/helpers/session-context";

// This file covers readCursorSession happy-path tests.
// Error cases for readCursorSession live in session-context.test.ts.

describe("readCursorSession", () => {
  // Redirect homedir() into a temp dir so these tests never touch the real
  // ~/.cursor/projects. A HOME env override does NOT work here — Bun caches
  // homedir() on Linux — so the implementation is mocked instead (ARCH-005).
  const projectRoot = "/__archgate_cursor_test_project";
  let tempHome: string;
  let homedirSpy: Mock<typeof os.homedir>;
  let transcriptsDir: string;

  beforeEach(async () => {
    tempHome = mkdtempSync(join(os.tmpdir(), "archgate-cursor-session-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);
    // Derived from the encoder rather than restated here: a hand-rolled copy
    // drifts silently, and these tests exercise the reader, not the encoding.
    // encodeProjectPath's own output is asserted in session-context.test.ts.
    const encodedProject = await encodeProjectPath(projectRoot, "cursor");
    transcriptsDir = join(
      tempHome,
      ".cursor",
      "projects",
      encodedProject,
      "agent-transcripts"
    );
    mkdirSync(transcriptsDir, { recursive: true });
  });

  afterEach(() => {
    homedirSpy.mockRestore();
    rmSync(tempHome, { recursive: true, force: true });
  });

  function makeSession(sessionId: string, lines: string[]): void {
    const sessionDir = join(transcriptsDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, `${sessionId}.jsonl`), lines.join("\n"));
  }

  // Discovery finds the file, the read then fails — permission-denied here,
  // a session removed mid-read in practice. Non-root POSIX only: chmod is a
  // no-op on Windows and root ignores the mode bits.
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports a read failure when the transcript cannot be read",
    async () => {
      makeSession("session-locked", ['{"role":"user"}']);
      const file = join(
        transcriptsDir,
        "session-locked",
        "session-locked.jsonl"
      );
      chmodSync(file, 0o000);
      try {
        const result = await readCursorSession(projectRoot);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected a failure result");
        expect(result.error).toBe("Failed to read session file");
      } finally {
        chmodSync(file, 0o600);
      }
    }
  );

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

  test("sessionId reads an earlier session; default reads the most recent", async () => {
    makeSession("session-earlier", [
      JSON.stringify({
        role: "user",
        message: { role: "user", content: "earlier question" },
      }),
      JSON.stringify({
        role: "assistant",
        message: { role: "assistant", content: "earlier answer" },
      }),
    ]);

    // Make the earlier dir older
    const { utimesSync } = await import("node:fs");
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(transcriptsDir, "session-earlier"), past, past);

    makeSession("session-current", [
      JSON.stringify({
        role: "user",
        message: { role: "user", content: "current msg" },
      }),
    ]);

    // Default → reads the most recent session (the current conversation)
    const latest = await readCursorSession(projectRoot);
    expect(latest.ok).toBe(true);
    if (!latest.ok) throw new Error("expected ok");
    expect(latest.data.sessionId).toBe("session-current");

    // sessionId → reads the earlier session explicitly
    const earlier = await readCursorSession(projectRoot, {
      sessionId: "session-earlier",
    });
    expect(earlier.ok).toBe(true);
    if (!earlier.ok) throw new Error("expected ok");
    expect(earlier.data.sessionId).toBe("session-earlier");
    expect(earlier.data.transcript[0]?.contentPreview).toBe("earlier question");
  });

  test("sessionId not found returns error with available ids", async () => {
    makeSession("session-only", [
      JSON.stringify({
        role: "user",
        message: { role: "user", content: "only session" },
      }),
    ]);

    const result = await readCursorSession(projectRoot, {
      sessionId: "session-nope",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Session not found: session-nope");
      expect(result.available).toEqual(["session-only"]);
    }
  });

  test("list returns sessions most recent first with timestamps", async () => {
    makeSession("session-earlier", [
      JSON.stringify({
        role: "user",
        message: { role: "user", content: "old" },
      }),
    ]);
    const { utimesSync } = await import("node:fs");
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(transcriptsDir, "session-earlier"), past, past);
    makeSession("session-current", [
      JSON.stringify({
        role: "user",
        message: { role: "user", content: "new" },
      }),
    ]);

    const result = await listCursorSessions(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.sessions.map((s) => s.id)).toEqual([
      "session-current",
      "session-earlier",
    ]);
    expect(Date.parse(result.data.sessions[0]?.updatedAt ?? "")).not.toBeNaN();
  });

  test("ignores non-directory entries in transcripts dir", async () => {
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

  test("ignores an entry whose stat fails (dangling link)", async () => {
    // A dangling link: readdir lists the entry, while stat follows it and
    // raises ENOENT.
    const danglingTarget = mkdtempSync(join(os.tmpdir(), "archgate-dangling-"));
    // "junction" so the link can be created unprivileged on Windows too;
    // the type argument is ignored on POSIX.
    symlinkSync(
      danglingTarget,
      join(transcriptsDir, "session-gone"),
      "junction"
    );
    rmSync(danglingTarget, { recursive: true, force: true });
    makeSession("session-live", [
      JSON.stringify({
        role: "user",
        message: { role: "user", content: "still here" },
      }),
    ]);

    const result = await listCursorSessions(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.data.sessions.map((s) => s.id)).toEqual(["session-live"]);
  });
});
