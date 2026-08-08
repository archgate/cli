// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  listCodexSessions,
  readCodexSession,
} from "../../src/helpers/session-context-codex";
import { restoreEnv, safeRmSync } from "../test-utils";

const PROJECT = join(tmpdir(), "__archgate_codex_project");
const OTHER_PROJECT = join(tmpdir(), "__archgate_codex_other");

/** The `session_meta` line, which carries the cwd a rollout belongs to. */
function meta(id: string, cwd: string): string {
  return `${JSON.stringify({
    timestamp: "2026-01-01T00:00:00.000Z",
    type: "session_meta",
    payload: { session_id: id, id, cwd, originator: "codex_cli_rs" },
  })}\n`;
}

/** An `event_msg` conversation line. */
function event(type: string, message: string): string {
  return `${JSON.stringify({
    timestamp: "2026-01-01T00:00:01.000Z",
    type: "event_msg",
    payload: { type, message },
  })}\n`;
}

describe("Codex session reader", () => {
  let codexHome: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    codexHome = mkdtempSync(join(tmpdir(), "archgate-codex-"));
    savedHome = Bun.env.CODEX_HOME;
    Bun.env.CODEX_HOME = codexHome;
  });

  afterEach(() => {
    restoreEnv("CODEX_HOME", savedHome);
    safeRmSync(codexHome);
  });

  /** Write a rollout into the YYYY/MM/DD shard Codex uses. */
  function writeRollout(id: string, cwd: string, body: string, day = "01") {
    const dir = join(codexHome, "sessions", "2026", "01", day);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `rollout-2026-01-${day}T00-00-00-${id}.jsonl`),
      meta(id, cwd) + body
    );
  }

  /** Write a zstd-compressed rollout, as Codex does after seven days. */
  function writeCompressedRollout(id: string, cwd: string, body: string) {
    const dir = join(codexHome, "sessions", "2026", "01", "02");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `rollout-2026-01-02T00-00-00-${id}.jsonl.zst`),
      Bun.zstdCompressSync(Buffer.from(meta(id, cwd) + body))
    );
  }

  test("reports a missing sessions directory", async () => {
    const result = await readCodexSession(PROJECT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No Codex sessions directory found");
  });

  test("reports when no rollout belongs to the project", async () => {
    writeRollout("id-other", OTHER_PROJECT, event("user_message", "hi"));

    const result = await readCodexSession(PROJECT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No Codex sessions found for this project");
  });

  test("reads user and agent turns", async () => {
    writeRollout(
      "id-1",
      PROJECT,
      event("user_message", "hello") + event("agent_message", "hi there")
    );

    const result = await readCodexSession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessionId).toBe("id-1");
    expect(result.data.transcript).toEqual([
      { role: "user", contentPreview: "hello" },
      { role: "assistant", contentPreview: "hi there" },
    ]);
  });

  test("reads a zstd-compressed rollout", async () => {
    // Codex compresses rollouts older than seven days in place, so a reader
    // that handled only .jsonl would see nothing beyond the last week.
    writeCompressedRollout(
      "id-old",
      PROJECT,
      event("user_message", "from the archive")
    );

    const result = await readCodexSession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessionFile).toEndWith(".jsonl.zst");
    expect(result.data.transcript).toEqual([
      { role: "user", contentPreview: "from the archive" },
    ]);
  });

  test("ignores response_item lines that repeat the same turns", async () => {
    // Rollouts carry the conversation twice; counting both would duplicate it.
    const responseItem = `${JSON.stringify({
      timestamp: "2026-01-01T00:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    })}\n`;
    writeRollout(
      "id-1",
      PROJECT,
      event("user_message", "hello") + responseItem
    );

    const result = await readCodexSession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript).toHaveLength(1);
  });

  test("skips non-conversation event types", async () => {
    writeRollout(
      "id-1",
      PROJECT,
      event("user_message", "keep") + event("token_count", "drop")
    );

    const result = await readCodexSession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript.map((t) => t.role)).toEqual(["user"]);
  });

  test("caps the transcript with maxEntries", async () => {
    writeRollout(
      "id-1",
      PROJECT,
      event("user_message", "one") +
        event("user_message", "two") +
        event("user_message", "three")
    );

    const result = await readCodexSession(PROJECT, { maxEntries: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript).toHaveLength(1);
    expect(result.data.relevantEntries).toBe(3);
  });

  test("selects a rollout by thread id", async () => {
    writeRollout("id-1", PROJECT, event("user_message", "first"));
    writeRollout("id-2", PROJECT, event("user_message", "second"), "03");

    const result = await readCodexSession(PROJECT, { sessionId: "id-2" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript[0]?.contentPreview).toBe("second");
  });

  test("reports an unknown thread id with the available ids", async () => {
    writeRollout("id-1", PROJECT, event("user_message", "first"));

    const result = await readCodexSession(PROJECT, { sessionId: "nope" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Session not found: nope");
    expect(result.available).toEqual(["id-1"]);
  });

  test("lists only rollouts for the project", async () => {
    writeRollout("id-1", PROJECT, event("user_message", "mine"));
    writeRollout("id-other", OTHER_PROJECT, event("user_message", "theirs"));

    const result = await listCodexSessions(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions.map((s) => s.id)).toEqual(["id-1"]);
  });

  test("ignores a rollout with no session_meta line", async () => {
    const dir = join(codexHome, "sessions", "2026", "01", "01");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "rollout-2026-01-01T00-00-00-id-nometa.jsonl"),
      event("user_message", "orphan")
    );

    const result = await readCodexSession(PROJECT);

    expect(result.ok).toBe(false);
  });

  test("reads a rollout that is still being appended to", async () => {
    // The live rollout is the common case, and its last line can be a
    // half-written record. Everything already flushed must still come back.
    writeRollout(
      "id-1",
      PROJECT,
      `${event("user_message", "complete")}{"type":"event_msg","payl`
    );

    const result = await readCodexSession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript).toEqual([
      { role: "user", contentPreview: "complete" },
    ]);
  });
});
