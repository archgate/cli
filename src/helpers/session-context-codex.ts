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

import type { BunFile } from "bun";
import { z } from "zod";

import { readIfExists } from "./fs-read";
import { logDebug } from "./log";
import { codexSessionsDir } from "./paths";
import {
  type ReadSessionOptions,
  type SessionListEntry,
  type SessionListResult,
  normalizePath,
  sessionReadFailure,
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
  item: z
    .object({
      type: z.string().default(""),
      content: z
        .array(z.object({ text: z.string().default("") }).loose())
        .optional(),
    })
    .optional(),
});

/**
 * `event_msg` payload types carrying a turn as a flat `message` string. The
 * desktop app records conversations this way.
 */
const ROLE_BY_EVENT = new Map([
  ["user_message", "user"],
  ["agent_message", "assistant"],
]);

/**
 * Item kinds carrying a turn inside an `item_completed` event — how the CLI
 * records conversations, nesting the text in content blocks. Both shapes live
 * under `event_msg`, so one pass reads either without double-counting.
 * `response_item` repeats the same turns wrapped in injected environment and
 * developer messages, so it stays unread.
 */
const ROLE_BY_ITEM = new Map([
  ["UserMessage", "user"],
  ["AgentMessage", "assistant"],
]);

const MAX_PREVIEW = 300;

/**
 * Conversation turn carried by an `event_msg` payload, in whichever shape the
 * writing distribution used, or null when the event is not a turn.
 */
function conversationTurn(
  payload: z.infer<typeof EventMsgPayloadSchema>
): { role: string; text: string } | null {
  const flatRole = ROLE_BY_EVENT.get(payload.type);
  if (flatRole !== undefined) return { role: flatRole, text: payload.message };

  const item = payload.item;
  if (payload.type !== "item_completed" || item === undefined) return null;
  const itemRole = ROLE_BY_ITEM.get(item.type);
  if (itemRole === undefined) return null;
  const text = (item.content ?? []).map((block) => block.text).join("");
  return text === "" ? null : { role: itemRole, text };
}

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
 * Bytes read from a rollout when only its `session_meta` is wanted. The meta
 * line is written at session creation, so the head is enough to classify a
 * rollout without paying for its whole transcript.
 */
const HEAD_BYTES = 64 * 1024;

/** Rollouts inspected at once during discovery. */
const DISCOVERY_CONCURRENCY = 8;

/**
 * Inflate only as far as the first {@link META_SCAN_LINES} lines.
 *
 * Discovery classifies a rollout from its `session_meta` line, so inflating the
 * rest is wasted: on an 8 MB rollout this returns in a tenth of the time a
 * whole-member inflate takes, holding the head rather than the transcript.
 */
async function readCompressedHead(file: BunFile): Promise<string> {
  // `new Response(...).textStream()` would fold the decoding in, but it is
  // absent from @types/bun 1.4.0 and casting past that costs more than the
  // reader it saves.
  const reader = file
    .stream()
    .pipeThrough(new DecompressionStream("zstd"))
    .getReader();
  const decoder = new TextDecoder();
  let text = "";
  let lines = 0;
  try {
    while (lines < META_SCAN_LINES) {
      // oxlint-disable-next-line no-await-in-loop -- each chunk depends on the previous read
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const char of chunk) if (char === "\n") lines++;
      text += chunk;
    }
  } finally {
    // Releases the underlying file handle when the loop exits early.
    await reader.cancel().catch(() => {
      // Already errored or closed — nothing left to release.
    });
  }
  return text;
}

/**
 * Read a rollout as text, transparently decompressing the `.zst` form.
 *
 * Codex compresses rollouts older than seven days in place, so a reader that
 * handled only `.jsonl` would see nothing beyond the most recent week.
 *
 * @param headOnly - Read just the head: {@link HEAD_BYTES} for a plain rollout,
 * {@link META_SCAN_LINES} lines for a compressed one.
 */
async function readRollout(
  file: string,
  headOnly = false
): Promise<string | null> {
  try {
    if (file.endsWith(COMPRESSED_SUFFIX)) {
      return await readIfExists(file, async (f) =>
        headOnly
          ? readCompressedHead(f)
          : new TextDecoder().decode(Bun.zstdDecompressSync(await f.bytes()))
      );
    }
    return await readIfExists(file, async (f) =>
      (headOnly ? f.slice(0, HEAD_BYTES) : f).text()
    );
  } catch {
    return null;
  }
}

/**
 * Map over items with a bounded number in flight.
 *
 * A sessions directory accumulates indefinitely, and discovery inflates every
 * compressed rollout it meets. Reading them all at once would hold each
 * inflated transcript in memory simultaneously.
 */
async function mapBounded<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (let i = cursor++; i < items.length; i = cursor++) {
        // Sequential within a worker is the mechanism: parallelism comes from
        // running `limit` workers, which is what keeps memory bounded.
        // oxlint-disable-next-line eslint/no-await-in-loop
        results[i] = await fn(items[i]);
      }
    }
  );
  await Promise.all(workers);
  return results;
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

  const inspected = await mapBounded(
    files,
    DISCOVERY_CONCURRENCY,
    async (file) => {
      const raw = await readRollout(file, true);
      return { file, meta: raw === null ? null : parseRolloutMeta(raw) };
    }
  );

  const found: CodexRollout[] = [];
  for (const { file, meta } of inspected) {
    if (meta === null) continue;
    if (meta.cwd === "" || normalizePath(meta.cwd) !== target) continue;
    const stat = statSync(file, { throwIfNoEntry: false });
    if (stat === undefined) continue;
    const mtime = stat.mtimeMs;
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
  if (raw === null) return sessionReadFailure(target.file);

  // Bun.JSONL.parse drops a trailing partial line, which a rollout being
  // appended to right now will have.
  const lines = Bun.JSONL.parse(raw);
  const totalEntries = lines.length;

  const transcript: CodexSessionSummary["transcript"] = [];
  for (const line of lines) {
    const entry = CodexLineSchema.safeParse(line);
    if (!entry.success || entry.data.type !== "event_msg") continue;
    const event = EventMsgPayloadSchema.safeParse(entry.data.payload ?? {});
    if (!event.success) continue;

    const turn = conversationTurn(event.data);
    if (turn === null) continue;
    transcript.push({
      role: turn.role,
      contentPreview:
        turn.text.length > MAX_PREVIEW
          ? `${turn.text.slice(0, MAX_PREVIEW)}...`
          : turn.text,
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
