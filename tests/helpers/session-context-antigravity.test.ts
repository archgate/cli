// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  listAntigravitySessions,
  readAntigravitySession,
} from "../../src/helpers/session-context-antigravity";
import { restoreEnv, safeRmSync } from "../test-utils";

const PROJECT = join(tmpdir(), "__archgate_agy_project");
const OTHER_PROJECT = join(tmpdir(), "__archgate_agy_other");

/**
 * A workspace URI embedded the way the CLI stores it: inside a protobuf blob,
 * so the URI is followed by tag bytes rather than terminated cleanly.
 */
function metadataBlob(workspace: string): Uint8Array {
  const uri = `file:///${workspace.replaceAll("\\", "/")}`;
  return new Uint8Array([
    0x0a,
    uri.length,
    ...new TextEncoder().encode(uri),
    0x1a,
    0x00,
    0x12,
  ]);
}

/** One transcript line, as the CLI writes it. */
function entry(type: string, content?: string): string {
  const base: Record<string, unknown> = {
    step_index: 0,
    source: "USER_EXPLICIT",
    type,
    status: "DONE",
    created_at: "2026-01-01T00:00:00Z",
  };
  if (content !== undefined) base.content = content;
  return `${JSON.stringify(base)}\n`;
}

const userEntry = (text: string) =>
  entry("USER_INPUT", `<USER_REQUEST>\n${text}\n</USER_REQUEST>`);
const assistantEntry = (text: string) => entry("PLANNER_RESPONSE", text);
/** A planner turn that only made a tool call carries no prose. */
const toolOnlyEntry = () => entry("PLANNER_RESPONSE", "");

describe("Antigravity CLI session reader", () => {
  let tempHome: string;
  let savedHome: string | undefined;
  let savedUserProfile: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "archgate-agy-"));
    savedHome = Bun.env.HOME;
    savedUserProfile = Bun.env.USERPROFILE;
    Bun.env.HOME = tempHome;
    Bun.env.USERPROFILE = tempHome;
  });

  afterEach(() => {
    restoreEnv("HOME", savedHome);
    restoreEnv("USERPROFILE", savedUserProfile);
    safeRmSync(tempHome);
  });

  /**
   * Write a conversation: the database naming its workspace, and the JSONL
   * transcript holding its turns.
   */
  function writeConversation(
    id: string,
    workspace: string,
    transcript?: string
  ) {
    const cliDir = join(tempHome, ".gemini", "antigravity-cli");
    const convDir = join(cliDir, "conversations");
    mkdirSync(convDir, { recursive: true });
    const db = new Database(join(convDir, `${id}.db`), { create: true });
    db.run(
      "CREATE TABLE trajectory_metadata_blob (id text DEFAULT 'main', data blob, PRIMARY KEY (id))"
    );
    db.run("INSERT INTO trajectory_metadata_blob (id, data) VALUES (?, ?)", [
      "main",
      metadataBlob(workspace),
    ]);
    db.close();

    if (transcript === undefined) return;
    const logs = join(cliDir, "brain", id, ".system_generated", "logs");
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(logs, "transcript_full.jsonl"), transcript);
  }

  test("reports a missing conversations directory", async () => {
    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(
      "No Antigravity CLI conversations directory"
    );
  });

  test("reports when no conversation belongs to the project", async () => {
    writeConversation("c1", OTHER_PROJECT, userEntry("hi"));

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No Antigravity CLI conversations found");
  });

  test("reads user and assistant turns", async () => {
    writeConversation(
      "c1",
      PROJECT,
      userEntry("what does this repo do?") +
        assistantEntry("It governs AI agents with ADRs.")
    );

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessionId).toBe("c1");
    expect(result.data.transcript).toEqual([
      { role: "user", contentPreview: "what does this repo do?" },
      { role: "assistant", contentPreview: "It governs AI agents with ADRs." },
    ]);
  });

  test("strips the USER_REQUEST wrapper from a user turn", async () => {
    writeConversation("c1", PROJECT, userEntry("plain question"));

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript[0]?.contentPreview).toBe("plain question");
  });

  test("drops metadata appended after the closing USER_REQUEST tag", async () => {
    // The CLI appends <ADDITIONAL_METADATA> after the closing tag, so the
    // wrapped span has to be extracted rather than the ends trimmed.
    const content =
      "<USER_REQUEST>\nwhat time is it?\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-01-01T00:00:00+00:00.\n</ADDITIONAL_METADATA>";
    writeConversation("c1", PROJECT, entry("USER_INPUT", content));

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript[0]?.contentPreview).toBe("what time is it?");
  });

  test("skips tool calls, results, and prose-less planner turns", async () => {
    // A planner turn that only issued a tool call has empty content; emitting
    // it would pad the transcript with blank assistant turns.
    writeConversation(
      "c1",
      PROJECT,
      userEntry("list the files") +
        toolOnlyEntry() +
        entry("RUN_COMMAND") +
        entry("LIST_DIRECTORY") +
        assistantEntry("Here they are.")
    );

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript.map((t) => t.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(result.data.totalEntries).toBe(5);
  });

  test("matches the workspace despite trailing bytes after the URI", async () => {
    // The URI sits inside a protobuf blob, so a permissive scan runs past its
    // end into the tag bytes and would match no project at all.
    writeConversation("c1", PROJECT, userEntry("still mine"));

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript).toHaveLength(1);
  });

  test("caps the transcript with maxEntries", async () => {
    writeConversation(
      "c1",
      PROJECT,
      userEntry("one") + userEntry("two") + userEntry("three")
    );

    const result = await readAntigravitySession(PROJECT, { maxEntries: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript).toHaveLength(1);
    expect(result.data.relevantEntries).toBe(3);
  });

  test("selects a conversation by id", async () => {
    writeConversation("c1", PROJECT, userEntry("first"));
    writeConversation("c2", PROJECT, userEntry("second"));

    const result = await readAntigravitySession(PROJECT, { sessionId: "c2" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript[0]?.contentPreview).toBe("second");
  });

  test("reports an unknown id with the available ids", async () => {
    writeConversation("c1", PROJECT, userEntry("first"));

    const result = await readAntigravitySession(PROJECT, { sessionId: "nope" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Session not found: nope");
    expect(result.available).toEqual(["c1"]);
  });

  test("reports a conversation with no transcript on disk", async () => {
    writeConversation("c1", PROJECT);

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Failed to read session file");
  });

  test("reads a transcript that is still being appended to", async () => {
    writeConversation(
      "c1",
      PROJECT,
      `${userEntry("complete")}{"type":"PLANNER_RESPONSE","cont`
    );

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript).toEqual([
      { role: "user", contentPreview: "complete" },
    ]);
  });

  test("lists only conversations for the project", async () => {
    writeConversation("mine", PROJECT, userEntry("mine"));
    writeConversation("theirs", OTHER_PROJECT, userEntry("theirs"));

    const result = listAntigravitySessions(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions.map((s) => s.id)).toEqual(["mine"]);
  });
});
