// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { logDebug } from "./log";
import { opencodeDbPath } from "./paths";
import { isWindows } from "./platform";
import {
  RELEVANT_ROLES,
  type ReadSessionOptions,
  type TranscriptEntry,
  getContentPreview,
} from "./session-context";

interface OpencodeSessionSummary {
  sessionId: string;
  totalEntries: number;
  relevantEntries: number;
  transcript: Array<{ role: string; contentPreview: string }>;
}

interface ReadOpencodeSessionOptions extends ReadSessionOptions {
  sessionId?: string;
  /**
   * Restrict selection to root sessions only (`parent_id IS NULL`) before
   * applying `skip`. Opencode is the only session-context backend with a
   * real parent/child session graph, so this option lives here rather than
   * in the shared `ReadSessionOptions`.
   *
   * Use this — not a bare `skip: 1` — when you need "the top-level
   * development session" from a sub-agent or an inline Skill invocation:
   * a plain recency-based skip cannot distinguish the true parent from a
   * sibling sub-agent session once more than one sibling exists.
   */
  root?: boolean;
}

type OpencodeSessionResult =
  | { ok: true; data: OpencodeSessionSummary }
  | { ok: false; error: string; path?: string; available?: string[] };

/**
 * Normalize a file path for cross-platform comparison.
 * Lowercases on Windows (case-insensitive FS), normalizes separators to `/`,
 * and resolves to an absolute path.
 */
function normalizePath(p: string): string {
  const resolved = resolve(p).replaceAll("\\", "/");
  return isWindows() ? resolved.toLowerCase() : resolved;
}

/**
 * Read an opencode session transcript for a project.
 *
 * Opencode stores data in a SQLite database at
 * `$XDG_DATA_HOME/opencode/opencode.db` (default `~/.local/share/opencode/opencode.db`):
 * - `session` table — session metadata with `directory` for project matching
 * - `message` table — messages with `role` in the `data` JSON column
 * - `part` table — content parts with `type` and `text` in the `data` JSON column
 *
 * Sessions are matched by comparing the `directory` field in session rows
 * to the provided project root.
 *
 * Opencode sessions form a real parent/child tree via the `session.parent_id`
 * column (sub-agent spawns create a child row; an inline Skill invocation
 * reuses the current row and creates no child at all). Pass `root: true` to
 * resolve the top-level session for the directory instead of guessing by
 * recency via `skip` — see `ReadOpencodeSessionOptions.root`.
 */
export function readOpencodeSession(
  projectRoot: string | null,
  options?: ReadOpencodeSessionOptions
): OpencodeSessionResult {
  const limit = options?.maxEntries ?? 200;
  const dbPath = opencodeDbPath();
  const normalizedProjectRoot = normalizePath(projectRoot ?? process.cwd());

  if (!existsSync(dbPath)) {
    return { ok: false, error: "No opencode database found", path: dbPath };
  }

  let db: Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return {
      ok: false,
      error: "Failed to open opencode database",
      path: dbPath,
    };
  }

  try {
    // 1. Find all sessions, sorted by most recently updated first
    interface SessionRow {
      id: string;
      directory: string;
      time_updated: number;
      parent_id: string | null;
    }
    const allSessions = db
      .query<SessionRow, []>(
        "SELECT id, directory, time_updated, parent_id FROM session ORDER BY time_updated DESC"
      )
      .all();

    if (allSessions.length === 0) {
      return { ok: false, error: "No opencode sessions found", path: dbPath };
    }

    // 2. Filter sessions by project path
    const matching = allSessions.filter(
      (s) => s.directory && normalizePath(s.directory) === normalizedProjectRoot
    );

    if (matching.length === 0) {
      return {
        ok: false,
        error: "No opencode sessions found for this project",
        path: dbPath,
        available: allSessions.map((s) => s.id),
      };
    }

    // 3. Select session by ID, or by recency within the chosen scope (with
    // optional skip).
    //
    // Opencode records true parent/child linkage via `parent_id` — a
    // sub-agent session (or an inline Skill invocation, which appends to the
    // *current* session row instead of creating a new one) can have any
    // number of sibling sessions sharing this directory. Sorting every
    // matching session by recency and taking the Nth (the plain `--skip`
    // behavior) cannot reliably reach "the top-level session": once more
    // than one sibling exists, whichever sibling was touched most recently
    // occupies that slot, not the parent. `root: true` sidesteps the
    // guesswork by filtering to sessions with no parent (the true root of
    // the tree) before applying `skip`.
    const skip = options?.skip ?? 0;
    const rootOnly = options?.root ?? false;
    const candidates = rootOnly
      ? matching.filter((s) => s.parent_id === null)
      : matching;
    const target = options?.sessionId
      ? matching.find((s) => s.id === options.sessionId)
      : candidates[skip];

    if (!target) {
      const scope = rootOnly ? "root session(s)" : "session(s)";
      const error = options?.sessionId
        ? `Session not found: ${options.sessionId}`
        : `Only ${String(candidates.length)} ${scope} available but --skip ${String(skip)} requested`;
      return { ok: false, error, available: candidates.map((s) => s.id) };
    }

    // 4. Read messages for the session
    interface MessageRow {
      id: string;
      role: string;
    }
    const messages = db
      .query<MessageRow, [string]>(
        "SELECT id, json_extract(data, '$.role') as role FROM message WHERE session_id = ? ORDER BY time_created"
      )
      .all(target.id);

    if (messages.length === 0) {
      return {
        ok: false,
        error: "Session exists but has no messages",
        path: dbPath,
      };
    }

    // 5. Build transcript from text parts, skipping synthetic entries
    interface PartRow {
      type: string;
      text: string | null;
      tool: string | null;
    }
    const partsQuery = db.prepare<PartRow, [string]>(
      "SELECT json_extract(data, '$.type') as type, json_extract(data, '$.text') as text, json_extract(data, '$.tool') as tool FROM part WHERE message_id = ? AND json_extract(data, '$.synthetic') IS NOT 1 ORDER BY time_created"
    );

    const relevant: OpencodeSessionSummary["transcript"] = [];
    for (const msg of messages) {
      if (!RELEVANT_ROLES.has(msg.role)) continue;

      const parts = partsQuery.all(msg.id);

      const contentParts: string[] = [];
      for (const part of parts) {
        if (part.type === "text" && part.text) {
          contentParts.push(part.text);
        } else if (part.type === "tool" && part.tool) {
          contentParts.push(`[tool: ${part.tool}]`);
        }
      }

      const content = contentParts.join("\n");
      if (content.length === 0) continue;

      const normalized: TranscriptEntry = { message: { content } };
      relevant.push({
        role: msg.role,
        contentPreview: getContentPreview(normalized),
      });
    }

    const trimmed = relevant.length > limit ? relevant.slice(-limit) : relevant;
    return {
      ok: true,
      data: {
        sessionId: target.id,
        totalEntries: messages.length,
        relevantEntries: relevant.length,
        transcript: trimmed,
      },
    };
  } catch (err) {
    logDebug(`Failed to read opencode database: ${String(err)}`);
    return {
      ok: false,
      error: "Failed to read opencode database",
      path: dbPath,
    };
  } finally {
    db.close();
  }
}
