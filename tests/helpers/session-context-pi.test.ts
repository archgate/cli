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
