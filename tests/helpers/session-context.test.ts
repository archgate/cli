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
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

import * as platform from "../../src/helpers/platform";
import {
  encodeProjectPath,
  getContentPreview,
  listClaudeCodeSessions,
  listCursorSessions,
  readClaudeCodeSession,
  readCursorSession,
} from "../../src/helpers/session-context";

// Cursor happy-path tests live in session-context-cursor.test.ts to stay under max-lines.

describe("encodeProjectPath", () => {
  test.each<[string, "cursor" | undefined, string]>([
    ["/home/user/project", undefined, "-home-user-project"],
    ["project", undefined, "project"],
    ["", undefined, ""],
    ["/a//b", undefined, "-a--b"],
    ["C:\\Users\\user\\project", undefined, "C--Users-user-project"],
    ["C:\\Users/user\\project", undefined, "C--Users-user-project"],
    ["/home/user/.config/project", undefined, "-home-user--config-project"],
    [
      "E:\\archgate\\cli\\.claude\\worktrees\\fancy-prancing-sedgewick",
      undefined,
      "E--archgate-cli--claude-worktrees-fancy-prancing-sedgewick",
    ],
    ["C:\\Users\\user\\project", "cursor", "C-Users-user-project"],
    ["C:\\Users/user\\project", "cursor", "C-Users-user-project"],
    // Cursor collapses each separator run to one dash, so a dot-segment
    // yields "-claude-", not "--claude-".
    [
      "E:\\archgate\\cli\\.claude\\worktrees\\fancy-prancing-sedgewick",
      "cursor",
      "E-archgate-cli-claude-worktrees-fancy-prancing-sedgewick",
    ],
    ["/home/user/.config/project", "cursor", "home-user-config-project"],
    ["/a//b", "cursor", "a-b"],
    // Leading and trailing dashes are trimmed.
    ["/home/user/project", "cursor", "home-user-project"],
    ["/trailing/", "cursor", "trailing"],
    ["project", "cursor", "project"],
    ["", "cursor", ""],
  ])("encodes %p (target=%p) -> %p", async (input, target, expected) => {
    expect(await encodeProjectPath(input, target)).toBe(expected);
  });

  test("cursor collapses separator runs the default target preserves", async () => {
    // A project under a dot-directory — every git worktree in .claude/ — is
    // where the two encodings diverge, and where reusing one for the other
    // resolves to a directory that does not exist.
    const worktree = "E:\\project\\.claude\\worktrees\\wt";

    expect(await encodeProjectPath(worktree, "cursor")).toBe(
      "E-project-claude-worktrees-wt"
    );
    expect(await encodeProjectPath(worktree)).toBe(
      "E--project--claude-worktrees-wt"
    );
  });
});

describe("encodeProjectPath under WSL", () => {
  // The Windows-side editor writes its session directory under the Windows
  // spelling of the project path, so the encoder must translate first.
  let isWSLSpy: Mock<typeof platform.isWSL>;
  let toWindowsPathSpy: Mock<typeof platform.toWindowsPath>;

  beforeEach(() => {
    isWSLSpy = spyOn(platform, "isWSL").mockReturnValue(true);
    toWindowsPathSpy = spyOn(platform, "toWindowsPath");
  });

  afterEach(() => {
    isWSLSpy.mockRestore();
    toWindowsPathSpy.mockRestore();
  });

  test("encodes the translated Windows path", async () => {
    toWindowsPathSpy.mockResolvedValue("C:\\Users\\me\\proj");

    expect(await encodeProjectPath("/home/me/proj")).toBe("C--Users-me-proj");
    expect(toWindowsPathSpy).toHaveBeenCalledWith("/home/me/proj");
  });

  test.each<[string, string | null]>([
    ["null", null],
    ["an empty string", ""],
  ])("keeps the Linux path when wslpath yields %s", async (_label, value) => {
    toWindowsPathSpy.mockResolvedValue(value);

    expect(await encodeProjectPath("/home/me/proj")).toBe("-home-me-proj");
  });
});

describe("getContentPreview", () => {
  test("returns an empty string when the entry carries no content", () => {
    expect(getContentPreview({ type: "user", role: "user" })).toBe("");
  });

  test("skips blocks with no recognized preview shape", () => {
    const preview = getContentPreview({
      type: "assistant",
      role: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "internal" }],
      },
    });

    expect(preview).toBe("");
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
    let tempHome: string;
    let homedirSpy: Mock<typeof os.homedir>;
    let projectsDir: string;

    beforeEach(async () => {
      tempHome = mkdtempSync(join(os.tmpdir(), "archgate-claude-session-"));
      homedirSpy = spyOn(os, "homedir").mockReturnValue(tempHome);
      // Derived from the encoder, not restated — a hand-rolled copy drifts
      // silently. The encoder's own output is asserted above.
      const encodedProject = await encodeProjectPath(projectRoot);
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

    // A session file can exist at discovery and be unreadable at the read:
    // removed in between, or permission-denied. readTextIfExists rejects
    // rather than yielding null there, which is the case sessionReadFailure
    // names. Only reproducible as a non-root POSIX user — chmod is a no-op on
    // Windows and root ignores the mode bits.
    test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "reports a read failure for a session file that cannot be read",
      async () => {
        const file = join(projectsDir, "session.jsonl");
        writeFileSync(file, '{"type":"user"}');
        chmodSync(file, 0o000);
        try {
          const result = await readClaudeCodeSession(projectRoot);
          expect(result.ok).toBe(false);
          if (result.ok) throw new Error("expected a failure result");
          expect(result.error).toBe("Failed to read session file");
        } finally {
          // Restore before afterEach's rmSync, which cannot remove it otherwise.
          chmodSync(file, 0o600);
        }
      }
    );

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
      expect(preview).toEndWith("...");
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

describe("listClaudeCodeSessions", () => {
  test("returns error when the projects directory cannot be read", async () => {
    const result = await listClaudeCodeSessions("/nonexistent/archgate/path");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("No session files found");
      expect(result.path).toContain("nonexistent");
    }
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

describe("listCursorSessions", () => {
  test("returns error when the transcripts directory cannot be read", async () => {
    const result = await listCursorSessions("/nonexistent/archgate/path");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("No Cursor agent-transcripts directory found");
      expect(result.path).toContain("nonexistent");
    }
  });
});
