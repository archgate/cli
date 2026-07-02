// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import {
  encodeProjectPath,
  listClaudeCodeSessions,
  readClaudeCodeSession,
  readCursorSession,
} from "../../src/helpers/session-context";

// Cursor happy-path tests live in session-context-cursor.test.ts to stay under max-lines.

describe("encodeProjectPath", () => {
  test("replaces forward slashes with dashes", async () => {
    expect(await encodeProjectPath("/home/user/project")).toBe(
      "-home-user-project"
    );
  });

  test("handles paths without slashes", async () => {
    expect(await encodeProjectPath("project")).toBe("project");
  });

  test("handles empty string", async () => {
    expect(await encodeProjectPath("")).toBe("");
  });

  test("replaces multiple consecutive slashes", async () => {
    expect(await encodeProjectPath("/a//b")).toBe("-a--b");
  });

  test("replaces backslashes and colons with dashes (Windows paths)", async () => {
    expect(await encodeProjectPath("C:\\Users\\user\\project")).toBe(
      "C--Users-user-project"
    );
  });

  test("handles mixed slashes", async () => {
    expect(await encodeProjectPath("C:\\Users/user\\project")).toBe(
      "C--Users-user-project"
    );
  });

  test("replaces dots with dashes", async () => {
    expect(await encodeProjectPath("/home/user/.config/project")).toBe(
      "-home-user--config-project"
    );
  });

  test("encodes Windows worktree path (colons, backslashes, dots)", async () => {
    expect(
      await encodeProjectPath(
        "E:\\archgate\\cli\\.claude\\worktrees\\fancy-prancing-sedgewick"
      )
    ).toBe("E--archgate-cli--claude-worktrees-fancy-prancing-sedgewick");
  });

  test("cursor target strips colons instead of replacing with dashes", async () => {
    expect(await encodeProjectPath("C:\\Users\\user\\project", "cursor")).toBe(
      "C-Users-user-project"
    );
  });

  test("cursor target handles mixed slashes", async () => {
    expect(await encodeProjectPath("C:\\Users/user\\project", "cursor")).toBe(
      "C-Users-user-project"
    );
  });

  test("cursor target encodes Windows worktree path", async () => {
    expect(
      await encodeProjectPath(
        "E:\\archgate\\cli\\.claude\\worktrees\\fancy-prancing-sedgewick",
        "cursor"
      )
    ).toBe("E-archgate-cli--claude-worktrees-fancy-prancing-sedgewick");
  });

  test("cursor target produces same result as default for Unix paths", async () => {
    const unixPath = "/home/user/project";
    expect(await encodeProjectPath(unixPath, "cursor")).toBe(
      await encodeProjectPath(unixPath)
    );
  });
});

describe("readClaudeCodeSession", () => {
  test("returns error when no session files found", async () => {
    const result = await readClaudeCodeSession("/nonexistent/path");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No session files found");
    }
  });

  test("returns error for non-existent project dir", async () => {
    const result = await readClaudeCodeSession("/definitely/not/a/real/path");
    expect(result.ok).toBe(false);
  });

  describe("happy path", () => {
    // Redirect homedir() into a temp dir so these tests never touch the real
    // ~/.claude/projects. A HOME env override does NOT work here — Bun caches
    // homedir() on Linux — so the implementation is mocked instead (ARCH-005).
    const projectRoot = "/__archgate_test_project";
    const encodedProject = projectRoot
      .replaceAll("/", "-")
      .replaceAll("\\", "-")
      .replaceAll(":", "-")
      .replaceAll(".", "-");
    let tempHome: string;
    let homedirSpy: ReturnType<typeof spyOn>;
    let projectsDir: string;

    beforeEach(() => {
      tempHome = mkdtempSync(join(os.tmpdir(), "archgate-claude-session-"));
      homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);
      projectsDir = join(tempHome, ".claude", "projects", encodedProject);
      mkdirSync(projectsDir, { recursive: true });
    });

    afterEach(() => {
      homedirSpy.mockRestore();
      rmSync(tempHome, { recursive: true, force: true });
    });

    function writeSession(entries: object[]): void {
      writeFileSync(
        join(projectsDir, "session.jsonl"),
        entries.map((e) => JSON.stringify(e)).join("\n")
      );
    }

    test("returns data with correct transcript when JSONL exists", async () => {
      writeSession([
        { type: "user", message: { role: "user", content: "hello" } },
        {
          type: "assistant",
          message: { role: "assistant", content: "hi there" },
        },
        { type: "system", message: { role: "system", content: "ignored" } },
      ]);

      const result = await readClaudeCodeSession(projectRoot);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.data.sessionFile).toBe("session.jsonl");
      expect(result.data.totalEntries).toBe(3);
      expect(result.data.relevantEntries).toBe(2);
      expect(result.data.transcript[0]).toEqual({
        type: "user",
        role: "user",
        contentPreview: "hello",
      });
      expect(result.data.transcript[1]).toEqual({
        type: "assistant",
        role: "assistant",
        contentPreview: "hi there",
      });
    });

    test("filters to only user/assistant types", async () => {
      writeSession([
        { type: "system", message: { role: "system", content: "sys msg" } },
        { type: "tool", message: { role: "tool", content: "tool output" } },
        { type: "user", message: { role: "user", content: "only this" } },
      ]);

      const result = await readClaudeCodeSession(projectRoot);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.data.relevantEntries).toBe(1);
      expect(result.data.transcript[0]?.contentPreview).toBe("only this");
    });

    test("truncates string content preview to 500 chars", async () => {
      writeSession([
        { type: "user", message: { role: "user", content: "x".repeat(600) } },
      ]);

      const result = await readClaudeCodeSession(projectRoot);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      const preview = result.data.transcript[0]?.contentPreview ?? "";
      expect(preview).toHaveLength(503); // 500 chars + "..."
      expect(preview.endsWith("...")).toBe(true);
    });

    test("handles array content: text truncation, tool_use, tool_result", async () => {
      writeSession([
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "y".repeat(400) },
              { type: "tool_use", name: "bash", id: "tool-1" },
            ],
          },
        },
        {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_abc123",
                content: "res",
              },
            ],
          },
        },
      ]);

      const result = await readClaudeCodeSession(projectRoot);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      const assistantPreview = result.data.transcript[0]?.contentPreview ?? "";
      expect(assistantPreview).toHaveLength(303 + " | [tool_use: bash]".length);
      expect(assistantPreview).toContain("[tool_use: bash]");
      expect(result.data.transcript[1]?.contentPreview).toContain(
        "[tool_result: toolu_abc123]"
      );
    });

    test("respects maxEntries — keeps last N relevant entries", async () => {
      writeSession(
        Array.from({ length: 10 }, (_, i) => ({
          type: i % 2 === 0 ? "user" : "assistant",
          message: {
            role: i % 2 === 0 ? "user" : "assistant",
            content: `message ${i}`,
          },
        }))
      );

      const result = await readClaudeCodeSession(projectRoot, {
        maxEntries: 3,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.data.relevantEntries).toBe(10);
      expect(result.data.transcript).toHaveLength(3);
      expect(result.data.transcript[2]?.contentPreview).toBe("message 9");
    });

    test("sessionId reads a specific earlier session file", async () => {
      // Write a newer session file (the current conversation)
      writeFileSync(
        join(projectsDir, "current.jsonl"),
        [
          JSON.stringify({
            type: "user",
            message: { role: "user", content: "current msg" },
          }),
        ].join("\n")
      );

      // Write an older session file (an earlier conversation)
      const olderFile = join(projectsDir, "earlier.jsonl");
      writeFileSync(
        olderFile,
        [
          JSON.stringify({
            type: "user",
            message: { role: "user", content: "earlier msg" },
          }),
          JSON.stringify({
            type: "assistant",
            message: { role: "assistant", content: "earlier reply" },
          }),
        ].join("\n")
      );

      // Backdate the earlier session's mtime
      const { utimesSync } = await import("node:fs");
      const past = new Date(Date.now() - 60_000);
      utimesSync(olderFile, past, past);

      // Default → reads the most recent session (the current conversation)
      const latest = await readClaudeCodeSession(projectRoot);
      expect(latest.ok).toBe(true);
      if (!latest.ok) throw new Error("expected ok");
      expect(latest.data.transcript[0]?.contentPreview).toBe("current msg");

      // sessionId → reads the earlier conversation explicitly
      const earlier = await readClaudeCodeSession(projectRoot, {
        sessionId: "earlier",
      });
      expect(earlier.ok).toBe(true);
      if (!earlier.ok) throw new Error("expected ok");
      expect(earlier.data.transcript[0]?.contentPreview).toBe("earlier msg");
      expect(earlier.data.relevantEntries).toBe(2);
    });

    test("sessionId not found returns error with available ids", async () => {
      writeSession([
        { type: "user", message: { role: "user", content: "only session" } },
      ]);

      const result = await readClaudeCodeSession(projectRoot, {
        sessionId: "nonexistent",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Session not found: nonexistent");
        expect(result.available).toEqual(["session"]);
      }
    });

    test("list returns sessions most recent first with timestamps", async () => {
      writeFileSync(
        join(projectsDir, "current.jsonl"),
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "hi" },
        })
      );
      const olderFile = join(projectsDir, "earlier.jsonl");
      writeFileSync(
        olderFile,
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "old" },
        })
      );
      const { utimesSync } = await import("node:fs");
      const past = new Date(Date.now() - 60_000);
      utimesSync(olderFile, past, past);

      const result = await listClaudeCodeSessions(projectRoot);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.data.sessions.map((s) => s.id)).toEqual([
        "current",
        "earlier",
      ]);
      expect(
        Date.parse(result.data.sessions[0]?.updatedAt ?? "")
      ).not.toBeNaN();
    });

    test("returns error when directory exists but has no .jsonl files", async () => {
      writeFileSync(join(projectsDir, "notes.txt"), "not a session");

      const result = await readClaudeCodeSession(projectRoot);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toContain("No JSONL session files found");
    });

    test("returns error when JSONL file is malformed", async () => {
      writeFileSync(
        join(projectsDir, "session.jsonl"),
        "not valid jsonl }{garbage"
      );

      const result = await readClaudeCodeSession(projectRoot);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toContain("Failed to read session file");
    });
  });
});

describe("readCursorSession", () => {
  test("returns error when no transcripts directory found", async () => {
    const result = await readCursorSession("/nonexistent/path");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(
        "No Cursor agent-transcripts directory found"
      );
    }
  });

  // Happy-path tests with temp home dir are in session-context-cursor.test.ts.
});
