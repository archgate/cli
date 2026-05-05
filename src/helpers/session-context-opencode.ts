import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { logDebug } from "./log";
import { opencodeStorageDir } from "./paths";
import { isWindows } from "./platform";
import {
  RELEVANT_ROLES,
  type ReadSessionOptions,
  type TranscriptEntry,
  getContentPreview,
} from "./session-context";

export interface OpencodeSessionSummary {
  sessionId: string;
  totalEntries: number;
  relevantEntries: number;
  transcript: Array<{ role: string; contentPreview: string }>;
}

export interface ReadOpencodeSessionOptions extends ReadSessionOptions {
  sessionId?: string;
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

interface SessionMeta {
  id: string;
  path: string;
  updatedAt: number;
  projectHash: string;
}

/**
 * Read an opencode session transcript for a project.
 *
 * Opencode stores data under `~/.local/share/opencode/storage/`:
 * - `session/<projectHash>/<sessionID>.json` — session metadata
 * - `message/<sessionID>/<messageID>.json`   — individual messages
 *
 * Sessions are matched by comparing the `path` field in session metadata
 * to the provided project root.
 */
export async function readOpencodeSession(
  projectRoot: string | null,
  options?: ReadOpencodeSessionOptions
): Promise<OpencodeSessionResult> {
  const limit = options?.maxEntries ?? 200;
  const storageDir = opencodeStorageDir();
  const sessionsRoot = join(storageDir, "session");
  const normalizedProjectRoot = normalizePath(projectRoot ?? process.cwd());

  // 1. Scan session/<projectHash>/ directories for session JSON files
  const allSessions: SessionMeta[] = [];

  let projectHashDirs: string[];
  try {
    projectHashDirs = readdirSync(sessionsRoot).filter((name) => {
      try {
        return statSync(join(sessionsRoot, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return {
      ok: false,
      error: "No opencode session storage found",
      path: sessionsRoot,
    };
  }

  for (const hashDir of projectHashDirs) {
    const hashPath = join(sessionsRoot, hashDir);
    let sessionFiles: string[];
    try {
      sessionFiles = readdirSync(hashPath).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }

    for (const file of sessionFiles) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- sequential read needed: each session file determines project match
        const raw = await Bun.file(join(hashPath, file)).json();
        const meta = raw as Record<string, unknown>;
        const id = typeof meta.id === "string" ? meta.id : null;
        const sessionPath = typeof meta.path === "string" ? meta.path : null;
        if (!id) continue;
        // Parse updated_at — may be ISO string or camelCase variant
        let updatedAt = 0;
        if (typeof meta.updated_at === "string") {
          updatedAt = new Date(meta.updated_at).getTime();
        } else if (typeof meta.updatedAt === "string") {
          updatedAt = new Date(meta.updatedAt as string).getTime();
        } else if (typeof meta.updated_at === "number") {
          updatedAt = meta.updated_at;
        }

        allSessions.push({
          id,
          path: sessionPath ?? "",
          updatedAt,
          projectHash: hashDir,
        });
      } catch {
        logDebug(`Skipping session file ${file}: parse error`);
      }
    }
  }

  if (allSessions.length === 0) {
    return {
      ok: false,
      error: "No opencode sessions found",
      path: sessionsRoot,
    };
  }

  // 2. Filter sessions by project path
  const matching = allSessions
    .filter((s) => s.path && normalizePath(s.path) === normalizedProjectRoot)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (matching.length === 0) {
    return {
      ok: false,
      error: "No opencode sessions found for this project",
      path: sessionsRoot,
      available: allSessions.map((s) => s.id),
    };
  }

  // 3. Select session by ID or most recent
  const target = options?.sessionId
    ? matching.find((s) => s.id === options.sessionId)
    : matching[0];

  if (!target) {
    return {
      ok: false,
      error: `Session not found: ${options?.sessionId}`,
      available: matching.map((s) => s.id),
    };
  }

  // 4. Read message files from message/<sessionID>/
  const messagesDir = join(storageDir, "message", target.id);
  let messageFiles: string[];
  try {
    messageFiles = readdirSync(messagesDir)
      .filter((f) => f.endsWith(".json"))
      .sort(); // Lexicographic sort — message IDs are ordered
  } catch {
    return {
      ok: false,
      error: "Session exists but has no messages",
      path: messagesDir,
    };
  }

  if (messageFiles.length === 0) {
    return {
      ok: false,
      error: "Session exists but message directory is empty",
      path: messagesDir,
    };
  }

  // 5. Parse messages, filter to user/assistant, extract previews
  interface MessageData {
    role?: string;
    content?: unknown;
  }
  const allMessages: MessageData[] = [];
  for (const file of messageFiles) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- sequential read needed: message files must be read in order
      const data = (await Bun.file(join(messagesDir, file)).json()) as Record<
        string,
        unknown
      >;
      allMessages.push({
        role: typeof data.role === "string" ? data.role : undefined,
        content: data.content,
      });
    } catch {
      logDebug(`Skipping message file ${file}: parse error`);
    }
  }

  const relevant: OpencodeSessionSummary["transcript"] = [];
  for (const msg of allMessages) {
    if (!RELEVANT_ROLES.has(msg.role ?? "")) continue;
    // Normalize to TranscriptEntry shape for getContentPreview
    const normalized: TranscriptEntry = { message: { content: msg.content } };
    relevant.push({
      role: msg.role!,
      contentPreview: getContentPreview(normalized),
    });
  }

  const trimmed = relevant.length > limit ? relevant.slice(-limit) : relevant;
  return {
    ok: true,
    data: {
      sessionId: target.id,
      totalEntries: allMessages.length,
      relevantEntries: relevant.length,
      transcript: trimmed,
    },
  };
}
