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

import { readTextIfExists } from "./fs-read";
import { nestedStringFromJsonEnv } from "./harness-detect";
import { logDebug } from "./log";
import {
  antigravityCliDir,
  antigravityConversationsDir,
  antigravityDataDirs,
  usableEnv,
} from "./paths";
import {
  type ReadSessionOptions,
  type SessionListEntry,
  type SessionListResult,
  normalizePath,
  sessionReadFailure,
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

/** Row of the shared summaries index. */
interface SummaryRow {
  conversation_id: string;
  workspace_uris: string;
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

/**
 * Transcript filenames, most complete first. The CLI writes both; the desktop
 * app writes only the truncated one.
 */
const TRANSCRIPT_NAMES = ["transcript_full.jsonl", "transcript.jsonl"];

/** Directory holding a conversation's generated logs within a data directory. */
function logsDir(dataDir: string, conversationId: string): string {
  return join(dataDir, "brain", conversationId, ".system_generated", "logs");
}

/**
 * Locate a conversation's transcript across both data directories.
 *
 * A conversation belongs to whichever distribution created it, and the two
 * write to separate trees, so both are searched.
 */
function transcriptPath(conversationId: string): string | null {
  for (const dataDir of antigravityDataDirs()) {
    for (const name of TRANSCRIPT_NAMES) {
      const candidate = join(logsDir(dataDir, conversationId), name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Every conversation with a readable transcript, in either data directory. */
function conversationsWithTranscripts(): string[] {
  const ids = new Set<string>();
  for (const dataDir of antigravityDataDirs()) {
    const brain = join(dataDir, "brain");
    let entries: string[];
    try {
      entries = readdirSync(brain);
    } catch {
      continue;
    }
    for (const id of entries) {
      if (transcriptPath(id) !== null) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * A `file:///` URI, bounded to URI-legal characters. The CLI embeds one in a
 * protobuf blob, so a permissive class runs past the string's end into the
 * following tag bytes and yields a path that matches nothing.
 */
const FILE_URI = /file:\/\/\/[A-Za-z0-9%._~!$&'()*+,;=:@/-]+/u;

/** Decode a `file:///` URI into a plain path. */
function pathFromUri(uri: string): string | null {
  try {
    return decodeURIComponent(uri.replace(/^file:\/\/\//u, ""));
  } catch {
    return null;
  }
}

/** Workspace recorded in a CLI conversation's own database. */
function workspaceFromDb(file: string): string | null {
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
    const match = FILE_URI.exec(text);
    return match === null ? null : pathFromUri(match[0]);
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * Every workspace recorded in the shared summaries index, keyed by
 * conversation. The index covers the desktop app's conversations and lags a
 * live one, so it is a fallback rather than the primary source.
 */
function summaryWorkspaces(): Map<string, string> {
  const file = join(antigravityCliDir(), "conversation_summaries.db");
  if (!existsSync(file)) return new Map();

  let db: Database;
  try {
    db = new Database(file, { readonly: true });
  } catch {
    return new Map();
  }

  const workspaces = new Map<string, string>();
  try {
    const rows = db
      .query<SummaryRow, []>(
        "SELECT conversation_id, workspace_uris FROM conversation_summaries"
      )
      .all();
    for (const row of rows) {
      // The column holds a JSON array of URIs; the first match is its first
      // element, so the URI is taken directly rather than parsed out.
      const match = FILE_URI.exec(row.workspace_uris);
      const path = match === null ? null : pathFromUri(match[0]);
      if (path !== null) workspaces.set(row.conversation_id, path);
    }
  } catch {
    return new Map();
  } finally {
    db.close();
  }
  return workspaces;
}

/**
 * Workspace a conversation belongs to, from whichever store records it.
 *
 * @param summaries - The shared index, read once for the whole scan; opening
 * it per conversation would make discovery cost grow with the history.
 */
function workspaceFor(
  conversationId: string,
  summaries: Map<string, string>
): string | null {
  const cliDb = join(antigravityConversationsDir(), `${conversationId}.db`);
  if (existsSync(cliDb)) {
    const fromDb = workspaceFromDb(cliDb);
    if (fromDb !== null) return fromDb;
  }
  return summaries.get(conversationId) ?? null;
}

/**
 * Conversation the caller is running inside.
 *
 * The CLI names it in a flat variable; the desktop app nests it in JSON. A
 * live conversation is not always indexed yet, so it is admitted even when
 * its workspace cannot be resolved — it is the caller's own by definition.
 */
function currentConversationId(): string | null {
  const flat = usableEnv(Bun.env.ANTIGRAVITY_CONVERSATION_ID);
  if (flat !== null) return flat;

  return nestedStringFromJsonEnv("ANTIGRAVITY_SOURCE_METADATA", [
    "tool",
    "conversationId",
  ]);
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
  // Either tree counts: `brain` holds transcripts, `conversations` the
  // per-conversation databases. One without the other still means Antigravity
  // is installed, which is a different answer from having no conversations.
  const hasStore = antigravityDataDirs().some(
    (d) => existsSync(join(d, "brain")) || existsSync(join(d, "conversations"))
  );
  if (!hasStore) return null;

  const target = normalizePath(projectRoot ?? process.cwd());
  const current = currentConversationId();
  const summaries = summaryWorkspaces();

  const found: AntigravityConversation[] = [];
  for (const id of conversationsWithTranscripts()) {
    const workspace = workspaceFor(id, summaries);
    const matches = workspace !== null && normalizePath(workspace) === target;
    if (!matches && id !== current) continue;
    const file = transcriptPath(id);
    if (file === null) continue;
    const stat = statSync(file, { throwIfNoEntry: false });
    if (stat === undefined) continue;
    const mtime = stat.mtimeMs;
    found.push({ id, file, mtime });
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
  // Both trees are searched, so reporting only one would point troubleshooting
  // at a directory the caller's distribution never writes to.
  const dir = antigravityDataDirs().join(", ");
  const conversations = findConversations(projectRoot);
  if (conversations === null) {
    return {
      ok: false,
      error: "No Antigravity conversations directory found",
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
  // Both trees are searched, so reporting only one would point troubleshooting
  // at a directory the caller's distribution never writes to.
  const dir = antigravityDataDirs().join(", ");
  const conversations = findConversations(projectRoot);
  if (conversations === null) {
    return {
      ok: false,
      error: "No Antigravity conversations directory found",
      path: dir,
    };
  }
  if (conversations.length === 0) {
    return {
      ok: false,
      error: "No Antigravity conversations found for this project",
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

  const file = target.file;
  logDebug("Reading Antigravity transcript", file);
  const raw = await readTextIfExists(file).catch(() => null);
  if (raw === null) return sessionReadFailure(file);

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
