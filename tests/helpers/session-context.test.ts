import { describe, expect, test } from "bun:test";
import {
  encodeProjectPath,
  readClaudeCodeSession,
  readCursorSession,
} from "../../src/helpers/session-context";

describe("encodeProjectPath", () => {
  test("replaces forward slashes with dashes", () => {
    expect(encodeProjectPath("/home/user/project")).toBe("-home-user-project");
  });

  test("handles paths without slashes", () => {
    expect(encodeProjectPath("project")).toBe("project");
  });

  test("handles empty string", () => {
    expect(encodeProjectPath("")).toBe("");
  });

  test("replaces multiple consecutive slashes", () => {
    expect(encodeProjectPath("/a//b")).toBe("-a--b");
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
});
