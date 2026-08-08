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

/** Environment variables the reader consults, cleared for each test. */
const ENV_VARS = [
  "ANTIGRAVITY_AGENT",
  "ANTIGRAVITY_CONVERSATION_ID",
  "ANTIGRAVITY_SOURCE_METADATA",
] as const;

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

/** One transcript line, as either distribution writes it. */
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

describe("Antigravity session reader", () => {
  let tempHome: string;
  const saved = new Map<string, string | undefined>();
  let savedHome: string | undefined;
  let savedUserProfile: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "archgate-agy-"));
    savedHome = Bun.env.HOME;
    savedUserProfile = Bun.env.USERPROFILE;
    Bun.env.HOME = tempHome;
    Bun.env.USERPROFILE = tempHome;
    for (const key of ENV_VARS) {
      saved.set(key, Bun.env[key]);
      delete Bun.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_VARS) restoreEnv(key, saved.get(key));
    saved.clear();
    restoreEnv("HOME", savedHome);
    restoreEnv("USERPROFILE", savedUserProfile);
    safeRmSync(tempHome);
  });

  /** `antigravity-cli` is the CLI's data directory, `antigravity` the app's. */
  function dataDir(app: "cli" | "ide"): string {
    return join(
      tempHome,
      ".gemini",
      app === "cli" ? "antigravity-cli" : "antigravity"
    );
  }

  /** Write a conversation transcript into one distribution's store. */
  function writeTranscript(
    app: "cli" | "ide",
    id: string,
    transcript: string,
    name = app === "cli" ? "transcript_full.jsonl" : "transcript.jsonl"
  ) {
    const logs = join(dataDir(app), "brain", id, ".system_generated", "logs");
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(logs, name), transcript);
  }

  /** Record a CLI conversation's workspace in its own database. */
  function writeCliWorkspace(id: string, workspace: string) {
    const dir = join(dataDir("cli"), "conversations");
    mkdirSync(dir, { recursive: true });
    const db = new Database(join(dir, `${id}.db`), { create: true });
    db.run(
      "CREATE TABLE trajectory_metadata_blob (id text DEFAULT 'main', data blob, PRIMARY KEY (id))"
    );
    db.run("INSERT INTO trajectory_metadata_blob (id, data) VALUES (?, ?)", [
      "main",
      metadataBlob(workspace),
    ]);
    db.close();
  }

  /** Record a workspace in the shared summaries index the app relies on. */
  function writeSummary(id: string, workspace: string) {
    const dir = dataDir("cli");
    mkdirSync(dir, { recursive: true });
    const db = new Database(join(dir, "conversation_summaries.db"), {
      create: true,
    });
    db.run(
      "CREATE TABLE IF NOT EXISTS conversation_summaries (conversation_id text, workspace_uris text NOT NULL)"
    );
    db.run(
      "INSERT INTO conversation_summaries (conversation_id, workspace_uris) VALUES (?, ?)",
      [id, JSON.stringify([`file:///${workspace.replaceAll("\\", "/")}`])]
    );
    db.close();
  }

  test("reports a missing store", async () => {
    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No Antigravity conversations directory");
  });

  test("ignores a conversation directory holding no transcript", () => {
    mkdirSync(join(dataDir("cli"), "brain", "no-logs"), { recursive: true });
    writeCliWorkspace("c1", PROJECT);
    writeTranscript("cli", "c1", userEntry("hi"));

    const result = listAntigravitySessions(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions.map((s) => s.id)).toEqual(["c1"]);
  });

  test("falls back to the index when a conversation database cannot open", () => {
    writeTranscript("cli", "c1", userEntry("hi"));
    // A directory where the database belongs: opening it throws.
    mkdirSync(join(dataDir("cli"), "conversations", "c1.db"), {
      recursive: true,
    });
    writeSummary("c1", PROJECT);

    const result = listAntigravitySessions(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions.map((s) => s.id)).toEqual(["c1"]);
  });

  test("falls back to the index when the metadata table is absent", () => {
    writeTranscript("cli", "c1", userEntry("hi"));
    const dir = join(dataDir("cli"), "conversations");
    mkdirSync(dir, { recursive: true });
    const db = new Database(join(dir, "c1.db"), { create: true });
    db.run("CREATE TABLE unrelated (id text)");
    db.close();
    writeSummary("c1", PROJECT);

    const result = listAntigravitySessions(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions.map((s) => s.id)).toEqual(["c1"]);
  });

  test("reads a conversation when the summaries index cannot open", () => {
    writeCliWorkspace("c1", PROJECT);
    writeTranscript("cli", "c1", userEntry("hi"));
    mkdirSync(join(dataDir("cli"), "conversation_summaries.db"), {
      recursive: true,
    });

    const result = listAntigravitySessions(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions.map((s) => s.id)).toEqual(["c1"]);
  });

  test("reads a conversation when the summaries table is absent", () => {
    writeCliWorkspace("c1", PROJECT);
    writeTranscript("cli", "c1", userEntry("hi"));
    const db = new Database(join(dataDir("cli"), "conversation_summaries.db"), {
      create: true,
    });
    db.run("CREATE TABLE unrelated (id text)");
    db.close();

    const result = listAntigravitySessions(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions.map((s) => s.id)).toEqual(["c1"]);
  });

  test("ignores a workspace URI that cannot be decoded", async () => {
    writeTranscript("ide", "c1", userEntry("hi"));
    const dir = dataDir("cli");
    mkdirSync(dir, { recursive: true });
    const db = new Database(join(dir, "conversation_summaries.db"), {
      create: true,
    });
    db.run(
      "CREATE TABLE conversation_summaries (conversation_id text, workspace_uris text NOT NULL)"
    );
    // A stray percent sign makes the URI undecodable.
    db.run(
      "INSERT INTO conversation_summaries (conversation_id, workspace_uris) VALUES (?, ?)",
      ["c1", JSON.stringify(["file:///bad%zz"])]
    );
    db.close();

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No Antigravity conversations found");
  });

  test("reports a transcript that cannot be read", async () => {
    // A directory named like the transcript: discovered, then unreadable.
    mkdirSync(
      join(
        dataDir("cli"),
        "brain",
        "c1",
        ".system_generated",
        "logs",
        "transcript_full.jsonl"
      ),
      { recursive: true }
    );
    writeCliWorkspace("c1", PROJECT);

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Failed to read session file");
  });

  test("reports when no conversation belongs to the project", async () => {
    writeCliWorkspace("c1", OTHER_PROJECT);
    writeTranscript("cli", "c1", userEntry("hi"));

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No Antigravity conversations found");
  });

  test("reads a CLI conversation", async () => {
    writeCliWorkspace("c1", PROJECT);
    writeTranscript(
      "cli",
      "c1",
      userEntry("what does this repo do?") +
        assistantEntry("It governs AI agents with ADRs.")
    );

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript).toEqual([
      { role: "user", contentPreview: "what does this repo do?" },
      { role: "assistant", contentPreview: "It governs AI agents with ADRs." },
    ]);
  });

  test("reads a desktop app conversation via the summaries index", async () => {
    // The app keeps its conversations in a separate tree and records no
    // workspace of its own, so the shared index supplies it.
    writeSummary("ide1", PROJECT);
    writeTranscript("ide", "ide1", userEntry("from the app"));

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessionId).toBe("ide1");
    expect(result.data.sessionFile).toBe("transcript.jsonl");
  });

  test("reads the caller's own conversation before it is indexed", async () => {
    // A live conversation is not in the summaries index yet. It is the
    // caller's by definition, so it is admitted without a workspace match.
    Bun.env.ANTIGRAVITY_AGENT = "1";
    Bun.env.ANTIGRAVITY_SOURCE_METADATA = JSON.stringify({
      tool: { conversationId: "live" },
    });
    writeTranscript("ide", "live", userEntry("still running"));

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessionId).toBe("live");
  });

  test("prefers the untruncated transcript when both exist", async () => {
    writeCliWorkspace("c1", PROJECT);
    writeTranscript("cli", "c1", userEntry("full"), "transcript_full.jsonl");
    writeTranscript("cli", "c1", userEntry("truncated"), "transcript.jsonl");

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript[0]?.contentPreview).toBe("full");
  });

  test("strips the USER_REQUEST wrapper from a user turn", async () => {
    writeCliWorkspace("c1", PROJECT);
    writeTranscript("cli", "c1", userEntry("plain question"));

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript[0]?.contentPreview).toBe("plain question");
  });

  test("drops metadata appended after the closing USER_REQUEST tag", async () => {
    const content =
      "<USER_REQUEST>\nwhat time is it?\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-01-01T00:00:00+00:00.\n</ADDITIONAL_METADATA>";
    writeCliWorkspace("c1", PROJECT);
    writeTranscript("cli", "c1", entry("USER_INPUT", content));

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript[0]?.contentPreview).toBe("what time is it?");
  });

  test("skips tool calls, results, and prose-less planner turns", async () => {
    writeCliWorkspace("c1", PROJECT);
    writeTranscript(
      "cli",
      "c1",
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
    writeCliWorkspace("c1", PROJECT);
    writeTranscript("cli", "c1", userEntry("still mine"));

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript).toHaveLength(1);
  });

  test("caps the transcript with maxEntries", async () => {
    writeCliWorkspace("c1", PROJECT);
    writeTranscript(
      "cli",
      "c1",
      userEntry("one") + userEntry("two") + userEntry("three")
    );

    const result = await readAntigravitySession(PROJECT, { maxEntries: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript).toHaveLength(1);
    expect(result.data.relevantEntries).toBe(3);
  });

  test("selects a conversation by id", async () => {
    writeCliWorkspace("c1", PROJECT);
    writeTranscript("cli", "c1", userEntry("first"));
    writeCliWorkspace("c2", PROJECT);
    writeTranscript("cli", "c2", userEntry("second"));

    const result = await readAntigravitySession(PROJECT, { sessionId: "c2" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript[0]?.contentPreview).toBe("second");
  });

  test("reports an unknown id with the available ids", async () => {
    writeCliWorkspace("c1", PROJECT);
    writeTranscript("cli", "c1", userEntry("first"));

    const result = await readAntigravitySession(PROJECT, { sessionId: "nope" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Session not found: nope");
    expect(result.available).toEqual(["c1"]);
  });

  test("ignores a conversation with no transcript on disk", async () => {
    writeCliWorkspace("c1", PROJECT);

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No Antigravity conversations found");
  });

  test("reads a transcript that is still being appended to", async () => {
    writeCliWorkspace("c1", PROJECT);
    writeTranscript(
      "cli",
      "c1",
      `${userEntry("complete")}{"type":"PLANNER_RESPONSE","cont`
    );

    const result = await readAntigravitySession(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transcript).toEqual([
      { role: "user", contentPreview: "complete" },
    ]);
  });

  test("lists conversations from both stores for the project", async () => {
    writeCliWorkspace("fromCli", PROJECT);
    writeTranscript("cli", "fromCli", userEntry("cli"));
    writeSummary("fromIde", PROJECT);
    writeTranscript("ide", "fromIde", userEntry("ide"));
    writeCliWorkspace("elsewhere", OTHER_PROJECT);
    writeTranscript("cli", "elsewhere", userEntry("theirs"));

    const result = listAntigravitySessions(PROJECT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions.map((s) => s.id).sort()).toEqual([
      "fromCli",
      "fromIde",
    ]);
  });
});
