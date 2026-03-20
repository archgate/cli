import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  encodeProjectPath,
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

  test("replaces backslashes with dashes (Windows paths)", async () => {
    expect(await encodeProjectPath("C:\\Users\\user\\project")).toBe(
      "C:-Users-user-project"
    );
  });

  test("handles mixed slashes", async () => {
    expect(await encodeProjectPath("C:\\Users/user\\project")).toBe(
      "C:-Users-user-project"
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

  describe("happy path (with temp home dir)", () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalUserProfile: string | undefined;
    // The project path we'll use — encodeProjectPath("/myproject") = "-myproject"
    const projectRoot = "/myproject";
    const encodedProject = "-myproject";

    beforeEach(() => {
      originalHome = process.env["HOME"];
      originalUserProfile = process.env["USERPROFILE"];
      tmpHome = mkdtempSync(join(tmpdir(), "archgate-test-claude-"));
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

    function makeProjectDir(): string {
      const projectsDir = join(tmpHome, ".claude", "projects", encodedProject);
      mkdirSync(projectsDir, { recursive: true });
      return projectsDir;
    }

    function writeSession(dir: string, entries: object[]): void {
      writeFileSync(
        join(dir, "session.jsonl"),
        entries.map((e) => JSON.stringify(e)).join("\n")
      );
    }

    test("returns data with correct transcript when JSONL exists", async () => {
      const projectsDir = makeProjectDir();
      writeSession(projectsDir, [
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
      const projectsDir = makeProjectDir();
      writeSession(projectsDir, [
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
      const projectsDir = makeProjectDir();
      writeSession(projectsDir, [
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
      const projectsDir = makeProjectDir();
      writeSession(projectsDir, [
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
      const projectsDir = makeProjectDir();
      writeSession(
        projectsDir,
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

    test("returns error when directory exists but has no .jsonl files", async () => {
      const projectsDir = makeProjectDir();
      writeFileSync(join(projectsDir, "notes.txt"), "not a session");

      const result = await readClaudeCodeSession(projectRoot);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toContain("No JSONL session files found");
    });

    test("returns error when JSONL file is malformed", async () => {
      const projectsDir = makeProjectDir();
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
