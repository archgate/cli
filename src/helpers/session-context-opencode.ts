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
   * Resolve to the top-level (root) session. Without `sessionId` this is
   * an explicit alias for the default behavior (recency selection already
   * only considers top-level sessions); combined with a `sessionId` that
   * names a sub-agent child session, walks the `parent_id` chain up to the
   * top-level ancestor.
   *
   * Opencode is the only session-context backend with a real parent/child
   * session graph, so this option lives here rather than in the shared
   * `ReadSessionOptions`. A recency-based guess (the old bare `skip: 1`)
   * cannot distinguish the true parent from a sibling sub-agent session
   * once more than one sibling exists — and an inline Skill invocation
   * creates no session row at all, so there is nothing to skip past.
   * Ancestry via `parent_id` is correct regardless of nesting depth or
   * sibling fan-out.
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
 *   and `parent_id` linking sub-agent sessions to their parent
 * - `message` table — messages with `role` in the `data` JSON column
 * - `part` table — content parts with `type` and `text` in the `data` JSON column
 *
 * Sessions are matched by comparing the `directory` field in session rows
 * to the provided project root.
 *
 * Sub-agent runs are stored as child sessions (`parent_id` set) that share
 * the parent's `directory`, so recency-based selection (`skip`) only
 * considers top-level sessions — otherwise sub-agent transcripts shadow the
 * main session. Note that opencode skills run inline in the calling session
 * (they do NOT create their own session), so no `skip` is needed to read
 * the current development session. An explicit `sessionId` can still read
 * any session, including sub-agent children.
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
      parent_id: string | null;
      time_updated: number;
    }
    const allSessions = db
      .query<SessionRow, []>(
        "SELECT id, directory, parent_id, time_updated FROM session ORDER BY time_updated DESC"
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

    // 3. Select session by ID or most recent (with optional skip).
    // Recency selection only considers top-level sessions: sub-agent runs
    // are child sessions (parent_id set) sharing the parent's directory,
    // and would otherwise shadow the main session in the skip index.
    // An explicit --session-id can read any session, including children.
    const topLevel = matching.filter((s) => s.parent_id === null);
    const skip = options?.skip ?? 0;
    const target = options?.sessionId
      ? matching.find((s) => s.id === options.sessionId)
      : topLevel[skip];

    if (!target) {
      if (options?.sessionId) {
        return {
          ok: false,
          error: `Session not found: ${options.sessionId}`,
          available: matching.map((s) => s.id),
        };
      }
      return {
        ok: false,
        error: `Only ${String(topLevel.length)} top-level session(s) available but --skip ${String(skip)} requested`,
        available: topLevel.map((s) => s.id),
      };
    }

    // 3b. With --root, walk the parent_id chain up to the top-level
    // ancestor (relevant when --session-id names a sub-agent child).
    let selected = target;
    if (options?.root === true) {
      const byId = new Map(allSessions.map((s) => [s.id, s]));
      const seen = new Set<string>();
      while (selected.parent_id !== null && !seen.has(selected.id)) {
        seen.add(selected.id);
        const parent = byId.get(selected.parent_id);
        if (!parent) break;
        selected = parent;
      }
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
      .all(selected.id);

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
        sessionId: selected.id,
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
