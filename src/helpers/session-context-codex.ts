// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * session-context-codex.ts — Read OpenAI Codex rollout transcripts.
 *
 * Rollouts live under `~/.codex/sessions/YYYY/MM/DD/`, shared by the Codex
 * CLI and the desktop/IDE app. Each line is
 * `{timestamp, type, payload}`; a `session_meta` line carries the `cwd` that
 * ties the rollout to a project.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { z } from "zod";

import { logDebug } from "./log";
import { codexSessionsDir } from "./paths";
import {
  type ReadSessionOptions,
  type SessionListEntry,
  type SessionListResult,
  normalizePath,
} from "./session-context";

/** Rollouts older than a week are zstd-compressed in place by Codex. */
const COMPRESSED_SUFFIX = ".zst";

/** `rollout-<YYYY-MM-DDThh-mm-ss>-<threadId>.jsonl[.zst]` */
const ROLLOUT_NAME =
  /^rollout-\d{4}-\d{2}-\d{2}T[\d-]{8}-(?<id>.+?)\.jsonl(\.zst)?$/u;

/** Lines scanned for `session_meta` before giving up on a rollout. */
const META_SCAN_LINES = 50;

const CodexLineSchema = z.object({
  type: z.string().default(""),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const SessionMetaPayloadSchema = z.object({
  id: z.string().optional(),
  cwd: z.string().default(""),
});

const EventMsgPayloadSchema = z.object({
  type: z.string().default(""),
  message: z.string().default(""),
});

/** `event_msg` payload types that represent a conversation turn. */
const ROLE_BY_EVENT = new Map([
  ["user_message", "user"],
  ["agent_message", "assistant"],
]);

interface CodexSessionSummary {
  sessionId: string;
  sessionFile: string;
  totalEntries: number;
  relevantEntries: number;
  transcript: Array<{ role: string; contentPreview: string }>;
}

interface ReadCodexSessionOptions extends ReadSessionOptions {
  sessionId?: string;
}

type CodexSessionResult =
  | { ok: true; data: CodexSessionSummary }
  | { ok: false; error: string; path?: string; available?: string[] };

interface CodexRollout {
  id: string;
  file: string;
  mtime: number;
}

/**
 * Read a rollout as text, transparently decompressing the `.zst` form.
 *
 * Codex compresses rollouts older than seven days in place, so a reader that
 * handled only `.jsonl` would see nothing beyond the most recent week.
 */
async function readRollout(file: string): Promise<string | null> {
  try {
    if (file.endsWith(COMPRESSED_SUFFIX)) {
      const bytes = await Bun.file(file).bytes();
      return new TextDecoder().decode(Bun.zstdDecompressSync(bytes));
    }
    return await Bun.file(file).text();
  } catch {
    return null;
  }
}

/** Directory entries, or an empty list when the directory is unreadable. */
function readDirentsSafe(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Every rollout file under the date-sharded `sessions/` tree. */
function enumerateRolloutFiles(sessionsDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number): void => {
    const entries = readDirentsSafe(dir);
    for (const entry of entries) {
      const full = join(dir, entry.name);
      // sessions/YYYY/MM/DD — rollouts sit at the third level down.
      if (entry.isDirectory() && depth < 3) walk(full, depth + 1);
      else if (entry.isFile() && ROLLOUT_NAME.test(entry.name))
        files.push(full);
    }
  };
  walk(sessionsDir, 0);
  return files;
}

/**
 * Extract the thread id and recorded `cwd` from a rollout's `session_meta`.
 *
 * The meta line is written at session creation and is normally first, but the
 * head window is scanned rather than assuming an index, matching Codex's own
 * reader.
 */
function parseRolloutMeta(
  raw: string
): { id: string | undefined; cwd: string } | null {
  const head = raw.split("\n", META_SCAN_LINES).join("\n");
  for (const line of Bun.JSONL.parse(head)) {
    const entry = CodexLineSchema.safeParse(line);
    if (!entry.success || entry.data.type !== "session_meta") continue;
    const meta = SessionMetaPayloadSchema.safeParse(entry.data.payload ?? {});
    if (!meta.success) continue;
    return { id: meta.data.id, cwd: meta.data.cwd };
  }
  return null;
}

/** Thread id from a rollout filename, which embeds it verbatim. */
function idFromFilename(file: string): string {
  const match = ROLLOUT_NAME.exec(basename(file));
  return match?.groups?.id ?? basename(file);
}

/**
 * Find rollouts belonging to a project, most recent first.
 *
 * Codex records the working directory inside the file rather than encoding it
 * in the path, so every rollout's `session_meta` is inspected and compared
 * against the project root.
 */
async function findCodexRollouts(
  projectRoot: string | null
): Promise<CodexRollout[] | null> {
  const sessionsDir = codexSessionsDir();
  if (!existsSync(sessionsDir)) return null;

  const target = normalizePath(projectRoot ?? process.cwd());
  const files = enumerateRolloutFiles(sessionsDir);

  const inspected = await Promise.all(
    files.map(async (file) => {
      const raw = await readRollout(file);
      return { file, meta: raw === null ? null : parseRolloutMeta(raw) };
    })
  );

  const found: CodexRollout[] = [];
  for (const { file, meta } of inspected) {
    if (meta === null) continue;
    if (meta.cwd === "" || normalizePath(meta.cwd) !== target) continue;
    let mtime = 0;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      continue;
    }
    found.push({
      id:
        meta.id !== undefined && meta.id !== ""
          ? meta.id
          : idFromFilename(file),
      file,
      mtime,
    });
  }

  return found.sort((a, b) => b.mtime - a.mtime);
}

/**
 * List Codex sessions for a project, most recent first.
 *
 * @param projectRoot - Project to read sessions for; `null` falls back to cwd.
 */
export async function listCodexSessions(
  projectRoot: string | null
): Promise<SessionListResult> {
  const sessionsDir = codexSessionsDir();
  const rollouts = await findCodexRollouts(projectRoot);
  if (rollouts === null) {
    return {
      ok: false,
      error: "No Codex sessions directory found",
      path: sessionsDir,
    };
  }

  const sessions: SessionListEntry[] = rollouts.map((r) => ({
    id: r.id,
    updatedAt: new Date(r.mtime).toISOString(),
  }));
  return { ok: true, data: { sessions } };
}

/**
 * Read a Codex session transcript for a project.
 *
 * @param projectRoot - Project to read sessions for; `null` falls back to cwd.
 * @param options - `sessionId` selects a specific rollout by thread id;
 * `maxEntries` caps returned transcript entries.
 */
export async function readCodexSession(
  projectRoot: string | null,
  options?: ReadCodexSessionOptions
): Promise<CodexSessionResult> {
  const limit = options?.maxEntries ?? 200;
  const sessionsDir = codexSessionsDir();
  const rollouts = await findCodexRollouts(projectRoot);
  if (rollouts === null) {
    return {
      ok: false,
      error: "No Codex sessions directory found",
      path: sessionsDir,
    };
  }
  if (rollouts.length === 0) {
    return {
      ok: false,
      error: "No Codex sessions found for this project",
      path: sessionsDir,
    };
  }

  const requested = options?.sessionId;
  const target =
    requested !== undefined && requested !== ""
      ? rollouts.find((r) => r.id === requested)
      : rollouts[0];

  if (!target) {
    return {
      ok: false,
      error: `Session not found: ${requested ?? ""}`,
      available: rollouts.map((r) => r.id),
    };
  }

  logDebug("Reading Codex rollout", target.file);
  const raw = await readRollout(target.file);
  if (raw === null) {
    return {
      ok: false,
      error: "Failed to read session file",
      path: target.file,
    };
  }

  // Bun.JSONL.parse drops a trailing partial line, which a rollout being
  // appended to right now will have.
  const lines = Bun.JSONL.parse(raw);
  const totalEntries = lines.length;

  const transcript: CodexSessionSummary["transcript"] = [];
  for (const line of lines) {
    const entry = CodexLineSchema.safeParse(line);
    // `event_msg` carries pre-flattened text; `response_item` repeats the same
    // turns in the raw model format, so reading both would double-count.
    if (!entry.success || entry.data.type !== "event_msg") continue;
    const event = EventMsgPayloadSchema.safeParse(entry.data.payload ?? {});
    if (!event.success) continue;
    const role = ROLE_BY_EVENT.get(event.data.type);
    if (role === undefined) continue;
    const text = event.data.message;
    transcript.push({
      role,
      contentPreview: text.length > 300 ? `${text.slice(0, 300)}...` : text,
    });
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
