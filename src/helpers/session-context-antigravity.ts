// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * session-context-antigravity.ts — Read Antigravity CLI (`agy`) transcripts.
 *
 * The CLI writes each conversation's turns as JSONL under
 * `brain/<id>/.system_generated/logs/`, and keeps the workspace it belongs to
 * in a SQLite database under `conversations/`. The Antigravity IDE keeps a
 * separate store whose transcripts are encrypted at rest and cannot be read.
 */

import { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { z } from "zod";

import { logDebug } from "./log";
import { antigravityCliDir, antigravityConversationsDir } from "./paths";
import {
  type ReadSessionOptions,
  type SessionListEntry,
  type SessionListResult,
  normalizePath,
} from "./session-context";

/**
 * Transcript entry kinds that represent a conversation turn.
 *
 * `PLANNER_RESPONSE` is the agent's own reply; it carries empty content when
 * the turn was purely a tool call, so an empty body is skipped rather than
 * emitted as a blank turn. Every other kind is a tool call or its result.
 */
const TURN_ROLES = new Map([
  ["USER_INPUT", "user"],
  ["PLANNER_RESPONSE", "assistant"],
]);

/**
 * The CLI wraps a user turn's text in `<USER_REQUEST>`, and may append
 * `<ADDITIONAL_METADATA>` after the closing tag, so the wrapped span is
 * extracted rather than the tags stripped from the ends.
 */
const USER_REQUEST_BODY = /<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/u;

const MAX_PREVIEW = 300;

const TranscriptEntrySchema = z.object({
  type: z.string().default(""),
  content: z.string().default(""),
});

/** Row of `trajectory_metadata_blob`, holding the workspace URI. */
interface MetadataRow {
  data: Uint8Array | null;
}

interface AntigravitySessionSummary {
  sessionId: string;
  sessionFile: string;
  totalEntries: number;
  relevantEntries: number;
  transcript: Array<{ role: string; contentPreview: string }>;
}

interface ReadAntigravitySessionOptions extends ReadSessionOptions {
  sessionId?: string;
}

type AntigravitySessionResult =
  | { ok: true; data: AntigravitySessionSummary }
  | { ok: false; error: string; path?: string; available?: string[] };

/** Full JSONL transcript for a conversation. */
function transcriptPath(conversationId: string): string {
  return join(
    antigravityCliDir(),
    "brain",
    conversationId,
    ".system_generated",
    "logs",
    "transcript_full.jsonl"
  );
}

/**
 * Workspace directory a conversation belongs to.
 *
 * Only the conversation's own database records this — the shared summaries
 * database indexes the IDE's conversations, not the CLI's. The value is a
 * percent-encoded `file://` URI embedded in a protobuf blob.
 */
function conversationWorkspace(file: string): string | null {
  let db: Database;
  try {
    db = new Database(file, { readonly: true });
  } catch {
    return null;
  }

  try {
    const row = db
      .query<MetadataRow, []>("SELECT data FROM trajectory_metadata_blob")
      .get();
    if (row?.data === null || row?.data === undefined) return null;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(row.data);
    // Bounded to URI-legal characters: a permissive class runs past the
    // string's end into the following protobuf tag bytes and yields a path
    // that matches nothing.
    const match = /file:\/\/\/[A-Za-z0-9%._~!$&'()*+,;=:@/-]+/u.exec(text);
    if (match === null) return null;
    return decodeURIComponent(match[0].replace(/^file:\/\/\//u, ""));
  } catch {
    return null;
  } finally {
    db.close();
  }
}

interface AntigravityConversation {
  id: string;
  file: string;
  mtime: number;
}

/** Conversations belonging to a project, most recent first. */
function findConversations(
  projectRoot: string | null
): AntigravityConversation[] | null {
  const dir = antigravityConversationsDir();
  if (!existsSync(dir)) return null;

  const target = normalizePath(projectRoot ?? process.cwd());
  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith(".db"));
  } catch {
    return null;
  }

  const found: AntigravityConversation[] = [];
  for (const name of names) {
    const file = join(dir, name);
    const workspace = conversationWorkspace(file);
    if (workspace === null || normalizePath(workspace) !== target) continue;
    let mtime = 0;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      continue;
    }
    found.push({ id: basename(name, ".db"), file, mtime });
  }

  return found.sort((a, b) => b.mtime - a.mtime);
}

/**
 * List Antigravity CLI conversations for a project, most recent first.
 *
 * @param projectRoot - Project to read conversations for; `null` falls back
 * to cwd.
 */
export function listAntigravitySessions(
  projectRoot: string | null
): SessionListResult {
  const dir = antigravityConversationsDir();
  const conversations = findConversations(projectRoot);
  if (conversations === null) {
    return {
      ok: false,
      error: "No Antigravity CLI conversations directory found",
      path: dir,
    };
  }

  const sessions: SessionListEntry[] = conversations.map((c) => ({
    id: c.id,
    updatedAt: new Date(c.mtime).toISOString(),
  }));
  return { ok: true, data: { sessions } };
}

/**
 * Read an Antigravity CLI conversation transcript for a project.
 *
 * @param projectRoot - Project to read conversations for; `null` falls back
 * to cwd.
 * @param options - `sessionId` selects a conversation by id; `maxEntries`
 * caps returned transcript entries.
 */
export async function readAntigravitySession(
  projectRoot: string | null,
  options?: ReadAntigravitySessionOptions
): Promise<AntigravitySessionResult> {
  const limit = options?.maxEntries ?? 200;
  const dir = antigravityConversationsDir();
  const conversations = findConversations(projectRoot);
  if (conversations === null) {
    return {
      ok: false,
      error: "No Antigravity CLI conversations directory found",
      path: dir,
    };
  }
  if (conversations.length === 0) {
    return {
      ok: false,
      error: "No Antigravity CLI conversations found for this project",
      path: dir,
    };
  }

  const requested = options?.sessionId;
  const target =
    requested !== undefined && requested !== ""
      ? conversations.find((c) => c.id === requested)
      : conversations[0];

  if (!target) {
    return {
      ok: false,
      error: `Session not found: ${requested ?? ""}`,
      available: conversations.map((c) => c.id),
    };
  }

  const file = transcriptPath(target.id);
  logDebug("Reading Antigravity transcript", file);
  let raw: string;
  try {
    raw = await Bun.file(file).text();
  } catch {
    return { ok: false, error: "Failed to read session file", path: file };
  }

  // Bun.JSONL.parse drops a trailing partial line, which a conversation being
  // appended to right now will have.
  const lines = Bun.JSONL.parse(raw);
  const transcript: AntigravitySessionSummary["transcript"] = [];
  for (const line of lines) {
    const entry = TranscriptEntrySchema.safeParse(line);
    if (!entry.success) continue;
    const role = TURN_ROLES.get(entry.data.type);
    if (role === undefined) continue;
    const wrapped = USER_REQUEST_BODY.exec(entry.data.content);
    const text = (wrapped?.[1] ?? entry.data.content).trim();
    // A planner turn that only made a tool call carries no prose.
    if (text === "") continue;
    transcript.push({
      role,
      contentPreview:
        text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}...` : text,
    });
  }

  const trimmed =
    transcript.length > limit ? transcript.slice(-limit) : transcript;
  return {
    ok: true,
    data: {
      sessionId: target.id,
      sessionFile: basename(file),
      totalEntries: lines.length,
      relevantEntries: transcript.length,
      transcript: trimmed,
    },
  };
}
