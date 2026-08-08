// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  encodePiProjectDir,
  listPiSessions,
  readPiSession,
} from "../../src/helpers/session-context-pi";
import { restoreEnv, safeRmSync } from "../test-utils";

const PROJECT = join(tmpdir(), "__archgate_pi_project");
const OTHER_PROJECT = join(tmpdir(), "__archgate_pi_other");

/** A session header line, as Pi writes it at session creation. */
function header(id: string, cwd: string): string {
  return `${JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: new Date(0).toISOString(),
    cwd,
  })}\n`;
}

/** A `message` entry carrying one text block. */
function message(role: string, text: string): string {
  return `${JSON.stringify({
    type: "message",
    timestamp: new Date(0).toISOString(),
    message: { role, content: [{ type: "text", text }] },
  })}\n`;
}

describe("encodePiProjectDir", () => {
  // Mirrors Pi's own getDefaultSessionDirPath: drop one leading separator,
  // map / \ and : to a dash, wrap in double dashes. Runs are not collapsed
  // and dots survive, unlike Cursor's slug.
  test.each<[string, string]>([
    ["/home/user/project", "--home-user-project--"],
    // A drive letter yields two dashes: the colon and the separator after it
    // are each replaced, and runs are not collapsed.
    ["E:\\archgate\\cli", "--E--archgate-cli--"],
    ["E:\\archgate\\cli\\.claude\\wt", "--E--archgate-cli-.claude-wt--"],
    ["/a//b", "--a--b--"],
  ])("encodes %p -> %p", (input, expected) => {
    expect(encodePiProjectDir(input)).toBe(expected);
  });
});

describe("Pi session reader", () => {
  let tempHome: string;
  let savedSessionDir: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "archgate-pi-"));
    savedSessionDir = Bun.env.PI_CODING_AGENT_SESSION_DIR;
    Bun.env.PI_CODING_AGENT_SESSION_DIR = join(tempHome, "sessions");
  });

  afterEach(() => {
    restoreEnv("PI_CODING_AGENT_SESSION_DIR", savedSessionDir);
    safeRmSync(tempHome);
  });

  /** Write a session file into the shard for `cwd`. */
  function writeSession(name: string, id: string, cwd: string, body: string) {
    const dir = join(tempHome, "sessions", encodePiProjectDir(cwd));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.jsonl`), header(id, cwd) + body);
  }

  test("reports a missing sessions directory", async () => {
    Bun.env.PI_CODING_AGENT_SESSION_DIR = join(tempHome, "absent");

    const result = await readPiSession(PROJECT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No Pi sessions directory found");
  });

  test("tolerates a shard path that is not a directory", async () => {
    // The shard name is derived from the project path, so an unrelated file
    // can occupy it. Listing its entries fails and the scan yields nothing.
    const sessions = join(tempHome, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, encodePiProjectDir(PROJECT)), "not a dir");

    const result = await readPiSession(PROJECT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No Pi sessions found for this project");
  });

  test("skips a session entry whose header cannot be read", async () => {
    writeSession("good", "id-good", PROJECT, message("user", "hi"));
    // A directory named like a session file: enumerated, but unreadable.
    mkdirSync(
      join(tempHome, "sessions", encodePiProjectDir(PROJECT), "broken.jsonl"),
      { recursive: true }
    );

    const result = await listPiSessions(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions.map((s) => s.id)).toEqual(["id-good"]);
  });

  test("reports when no session belongs to the project", async () => {
    writeSession("s1", "id-other", OTHER_PROJECT, message("user", "hi"));

    const result = await readPiSession(PROJECT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No Pi sessions found for this project");
  });

  test("reads user and assistant turns", async () => {
    writeSession(
      "s1",
      "id-1",
      PROJECT,
      message("user", "hello") + message("assistant", "hi there")
    );

    const result = await readPiSession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessionId).toBe("id-1");
    expect(result.data.transcript).toEqual([
      { role: "user", contentPreview: "hello" },
      { role: "assistant", contentPreview: "hi there" },
    ]);
  });

  test("skips tool results and bash executions", async () => {
    // Pi gives tool output its own role rather than folding it into `user`,
    // so a role filter is enough to keep the transcript conversational.
    writeSession(
      "s1",
      "id-1",
      PROJECT,
      message("user", "run it") +
        message("toolResult", "tool output") +
        message("bashExecution", "$ ls") +
        message("assistant", "done")
    );

    const result = await readPiSession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript.map((t) => t.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  test("accepts string content as well as block arrays", async () => {
    const line = `${JSON.stringify({
      type: "message",
      message: { role: "user", content: "plain string" },
    })}\n`;
    writeSession("s1", "id-1", PROJECT, line);

    const result = await readPiSession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript).toEqual([
      { role: "user", contentPreview: "plain string" },
    ]);
  });

  test("ignores a session whose header names another project", async () => {
    // The shard encodes the project, but a relocated session dir does not, so
    // the header cwd is the authority.
    const dir = join(tempHome, "sessions", encodePiProjectDir(PROJECT));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "impostor.jsonl"),
      header("id-x", OTHER_PROJECT) + message("user", "not mine")
    );

    const result = await readPiSession(PROJECT);

    expect(result.ok).toBe(false);
  });

  test("skips a turn that carries no prose", async () => {
    // A turn that only made a tool call or thought has empty content;
    // emitting it would pad the transcript with blank entries.
    const empty = `${JSON.stringify({
      type: "message",
      message: { role: "assistant", content: [] },
    })}\n`;
    writeSession("s1", "id-1", PROJECT, empty + message("assistant", "real"));

    const result = await readPiSession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript).toEqual([
      { role: "assistant", contentPreview: "real" },
    ]);
  });

  test("follows the active branch after a fork", async () => {
    // Pi branches in place: /fork and /rewind leave the abandoned entries in
    // the same file, linked by id/parentId. Reading linearly would interleave
    // the abandoned turn with the live conversation.
    const linked = (id: string, parentId: string, role: string, text: string) =>
      `${JSON.stringify({
        type: "message",
        id,
        parentId,
        message: { role, content: [{ type: "text", text }] },
      })}\n`;

    writeSession(
      "s1",
      "id-1",
      PROJECT,
      linked("a", "root", "user", "shared question") +
        linked("abandoned", "a", "assistant", "discarded answer") +
        linked("b", "a", "assistant", "kept answer")
    );

    const result = await readPiSession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript).toEqual([
      { role: "user", contentPreview: "shared question" },
      { role: "assistant", contentPreview: "kept answer" },
    ]);
  });

  test("caps the transcript with maxEntries", async () => {
    writeSession(
      "s1",
      "id-1",
      PROJECT,
      message("user", "one") + message("user", "two") + message("user", "three")
    );

    const result = await readPiSession(PROJECT, { maxEntries: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript).toHaveLength(1);
    expect(result.data.relevantEntries).toBe(3);
  });

  test("selects a session by id", async () => {
    writeSession("s1", "id-1", PROJECT, message("user", "first"));
    writeSession("s2", "id-2", PROJECT, message("user", "second"));

    const result = await readPiSession(PROJECT, { sessionId: "id-2" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript[0]?.contentPreview).toBe("second");
  });

  test("reports an unknown session id with the available ids", async () => {
    writeSession("s1", "id-1", PROJECT, message("user", "first"));

    const result = await readPiSession(PROJECT, { sessionId: "nope" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Session not found: nope");
    expect(result.available).toEqual(["id-1"]);
  });

  test("reports a missing sessions directory when listing", async () => {
    Bun.env.PI_CODING_AGENT_SESSION_DIR = join(tempHome, "absent");

    const result = await listPiSessions(PROJECT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No Pi sessions directory found");
  });

  test("resolves sessions under PI_CODING_AGENT_DIR", async () => {
    // The agent-dir override relocates the whole config tree; sessions sit
    // beneath it unless the session-dir override also applies.
    const savedSessionDir = Bun.env.PI_CODING_AGENT_SESSION_DIR;
    const savedAgentDir = Bun.env.PI_CODING_AGENT_DIR;
    delete Bun.env.PI_CODING_AGENT_SESSION_DIR;
    Bun.env.PI_CODING_AGENT_DIR = join(tempHome, "agent");
    try {
      const dir = join(
        tempHome,
        "agent",
        "sessions",
        encodePiProjectDir(PROJECT)
      );
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "s1.jsonl"),
        header("id-agentdir", PROJECT) + message("user", "via agent dir")
      );

      const result = await readPiSession(PROJECT);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.sessionId).toBe("id-agentdir");
    } finally {
      restoreEnv("PI_CODING_AGENT_DIR", savedAgentDir);
      restoreEnv("PI_CODING_AGENT_SESSION_DIR", savedSessionDir);
    }
  });

  test("falls back to the filename when the header carries no id", async () => {
    const dir = join(tempHome, "sessions", encodePiProjectDir(PROJECT));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "2026-01-01T00-00-00_fallback.jsonl"),
      `${JSON.stringify({ type: "session", cwd: PROJECT })}\n${message("user", "x")}`
    );

    const result = await readPiSession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessionId).toBe("2026-01-01T00-00-00_fallback");
  });

  test("lists only sessions for the project", async () => {
    writeSession("s1", "id-1", PROJECT, message("user", "mine"));
    writeSession("s2", "id-other", OTHER_PROJECT, message("user", "theirs"));

    const result = await listPiSessions(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions.map((s) => s.id)).toEqual(["id-1"]);
  });

  test("reads a session that is still being appended to", async () => {
    // The live session is the common case, and its last line can be a
    // half-written record. Everything already flushed must still come back.
    writeSession(
      "s1",
      "id-1",
      PROJECT,
      `${message("user", "complete")}{"type":"message","message":{"role":"assis`
    );

    const result = await readPiSession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript).toEqual([
      { role: "user", contentPreview: "complete" },
    ]);
  });
});
