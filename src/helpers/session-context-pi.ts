// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * session-context-pi.ts — Read Pi coding-agent session transcripts.
 *
 * Sessions are JSONL under `~/.pi/agent/sessions/--<slug>--/`, where the slug
 * encodes the working directory. Line 1 is a `session` header carrying `cwd`;
 * later `message` entries hold the conversation.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { z } from "zod";

import { readIfExists, readTextIfExists } from "./fs-read";
import { logDebug } from "./log";
import { piSessionsDir } from "./paths";
import {
  MessageContentSchema,
  type ReadSessionOptions,
  type SessionListEntry,
  type SessionListResult,
  getContentPreview,
  normalizePath,
  sessionReadFailure,
} from "./session-context";

/** Roles that represent conversation turns; tool results carry their own role. */
const PI_RELEVANT_ROLES = new Set(["user", "assistant"]);

const PiHeaderSchema = z.object({
  type: z.literal("session"),
  id: z.string().default(""),
  cwd: z.string().default(""),
});

const PiEntrySchema = z.object({
  type: z.string().default(""),
  id: z.string().optional(),
  parentId: z.string().optional(),
  message: z
    .object({
      role: z.string().default(""),
      content: MessageContentSchema.optional(),
    })
    .optional(),
});

type PiEntry = z.infer<typeof PiEntrySchema>;

/**
 * Entries on the session's active branch, in file order.
 *
 * Pi branches in place rather than starting a new file, so `/fork` and
 * `/rewind` leave abandoned entries behind, linked by `id`/`parentId`. The
 * chain is walked back from the newest entry to skip them. Sessions predating
 * the tree format carry no ids and are returned whole.
 */
function activeBranch(entries: PiEntry[]): PiEntry[] {
  const leaf = entries.findLast((e) => e.id !== undefined);
  if (leaf === undefined) return entries;

  const byId = new Map(
    entries.filter((e) => e.id !== undefined).map((e) => [e.id, e])
  );
  const onPath = new Set<string>();
  let cursor: PiEntry | undefined = leaf;
  while (cursor?.id !== undefined && !onPath.has(cursor.id)) {
    onPath.add(cursor.id);
    cursor =
      cursor.parentId === undefined ? undefined : byId.get(cursor.parentId);
  }

  return entries.filter((e) => e.id === undefined || onPath.has(e.id));
}

interface PiSessionSummary {
  sessionId: string;
  sessionFile: string;
  totalEntries: number;
  relevantEntries: number;
  transcript: Array<{ role: string; contentPreview: string }>;
}

interface ReadPiSessionOptions extends ReadSessionOptions {
  sessionId?: string;
}

type PiSessionResult =
  | { ok: true; data: PiSessionSummary }
  | { ok: false; error: string; path?: string; available?: string[] };

/**
 * Encode a working directory the way Pi names its session shard: drop one
 * leading separator, map `/`, `\` and `:` to `-`, and wrap in `--`.
 *
 * Mirrors `getDefaultSessionDirPath` in Pi's `session-manager`. Runs are not
 * collapsed and dots are preserved, so the encoding is exact rather than
 * lossy.
 */
export function encodePiProjectDir(projectRoot: string): string {
  const slug = projectRoot.replace(/^[/\\]/u, "").replaceAll(/[/\\:]/gu, "-");
  return `--${slug}--`;
}

/** A session file with the mtime used for recency ordering. */
interface PiSessionFile {
  id: string;
  file: string;
  mtime: number;
}

/** Every `.jsonl` directly under `dir`, or an empty list when unreadable. */
function sessionFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Enumerate Pi session files for a project, most recent first.
 *
 * The shard directory encodes the project root, and each file's header `cwd`
 * is verified as well. Checking both also covers a relocated session
 * directory, whose shard name encodes nothing about the project path.
 */
async function findPiSessions(
  projectRoot: string | null
): Promise<PiSessionFile[] | null> {
  const sessionsDir = piSessionsDir();
  if (!existsSync(sessionsDir)) return null;

  const root = projectRoot ?? process.cwd();
  const target = normalizePath(root);
  const shard = join(sessionsDir, encodePiProjectDir(root));
  const searchDirs = existsSync(shard)
    ? [shard]
    : readdirSync(sessionsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(sessionsDir, e.name));

  const candidates = searchDirs.flatMap((dir) => sessionFilesIn(dir));
  const headers = await Promise.all(
    candidates.map(async (file) => ({ file, header: await readPiHeader(file) }))
  );

  const found: PiSessionFile[] = [];
  for (const { file, header } of headers) {
    if (header === null) continue;
    if (header.cwd === "" || normalizePath(header.cwd) !== target) continue;
    const stat = statSync(file, { throwIfNoEntry: false });
    if (stat === undefined) continue;
    const mtime = stat.mtimeMs;
    // The filename is `<timestamp>_<sessionId>`; the header id is authoritative.
    found.push({
      id: header.id === "" ? basename(file, ".jsonl") : header.id,
      file,
      mtime,
    });
  }

  return found.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Bytes read when only the header is wanted. It is line 1, so the head is
 * enough to classify a session without reading its whole transcript.
 */
const HEADER_BYTES = 64 * 1024;

/** Parse the leading `session` header, or null when the file is unusable. */
async function readPiHeader(
  file: string
): Promise<{ id: string; cwd: string } | null> {
  let firstLine: string;
  try {
    const head = await readIfExists(file, async (f) =>
      f.slice(0, HEADER_BYTES).text()
    );
    if (head === null) return null;
    firstLine = head.slice(0, head.indexOf("\n") + 1 || undefined).trim();
  } catch {
    return null;
  }
  if (firstLine === "") return null;
  const header = PiHeaderSchema.safeParse(Bun.JSONL.parse(firstLine)[0]);
  return header.success ? { id: header.data.id, cwd: header.data.cwd } : null;
}

/**
 * List Pi sessions for a project, most recent first.
 *
 * @param projectRoot - Project to read sessions for; `null` falls back to cwd.
 */
export async function listPiSessions(
  projectRoot: string | null
): Promise<SessionListResult> {
  const sessionsDir = piSessionsDir();
  const sessions = await findPiSessions(projectRoot);
  if (sessions === null) {
    return {
      ok: false,
      error: "No Pi sessions directory found",
      path: sessionsDir,
    };
  }

  const entries: SessionListEntry[] = sessions.map((s) => ({
    id: s.id,
    updatedAt: new Date(s.mtime).toISOString(),
  }));
  return { ok: true, data: { sessions: entries } };
}

/**
 * Read a Pi session transcript for a project.
 *
 * @param projectRoot - Project to read sessions for; `null` falls back to cwd.
 * @param options - `sessionId` selects a specific session; `maxEntries` caps
 * returned transcript entries.
 */
export async function readPiSession(
  projectRoot: string | null,
  options?: ReadPiSessionOptions
): Promise<PiSessionResult> {
  const limit = options?.maxEntries ?? 200;
  const sessionsDir = piSessionsDir();
  const sessions = await findPiSessions(projectRoot);
  if (sessions === null) {
    return {
      ok: false,
      error: "No Pi sessions directory found",
      path: sessionsDir,
    };
  }
  if (sessions.length === 0) {
    return {
      ok: false,
      error: "No Pi sessions found for this project",
      path: sessionsDir,
    };
  }

  const requested = options?.sessionId;
  const target =
    requested !== undefined && requested !== ""
      ? sessions.find((s) => s.id === requested)
      : sessions[0];

  if (!target) {
    return {
      ok: false,
      error: `Session not found: ${requested ?? ""}`,
      available: sessions.map((s) => s.id),
    };
  }

  logDebug("Reading Pi session", target.file);
  const raw = await readTextIfExists(target.file).catch(() => null);
  if (raw === null) return sessionReadFailure(target.file);

  // Bun.JSONL.parse drops a trailing partial line, which a session being
  // appended to right now will have.
  const lines = Bun.JSONL.parse(raw);
  const totalEntries = lines.length;

  const parsed: PiEntry[] = [];
  for (const line of lines) {
    const entry = PiEntrySchema.safeParse(line);
    if (entry.success) parsed.push(entry.data);
  }

  const transcript: PiSessionSummary["transcript"] = [];
  for (const entry of activeBranch(parsed)) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message === undefined || !PI_RELEVANT_ROLES.has(message.role)) continue;
    const contentPreview = getContentPreview({
      type: "message",
      role: message.role,
      message: { role: message.role, content: message.content },
    });
    // A turn that only made a tool call or thought carries no prose; emitting
    // it would pad the transcript with blank entries.
    if (contentPreview.trim() === "") continue;
    transcript.push({ role: message.role, contentPreview });
  }

  const trimmed =
    transcript.length > limit ? transcript.slice(-limit) : transcript;
  return {
    ok: true,
    data: {
      sessionId: target.id,
      sessionFile: basename(target.file),
      totalEntries,
      relevantEntries: transcript.length,
      transcript: trimmed,
    },
  };
}
