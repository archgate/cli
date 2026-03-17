import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { isWSL, toWindowsPath } from "./platform";

/**
 * Encode a project root path into the directory name used by Claude/Cursor.
 * In WSL, converts to Windows path first so the encoded name matches
 * what Windows-side Claude/Cursor uses.
 */
export async function encodeProjectPath(projectRoot: string): Promise<string> {
  if (isWSL()) {
    const winPath = await toWindowsPath(projectRoot);
    if (winPath) {
      return winPath.replaceAll("\\", "-").replaceAll("/", "-");
    }
  }
  return projectRoot.replaceAll("\\", "-").replaceAll("/", "-");
}

const RELEVANT_TYPES = new Set(["user", "assistant"]);
const RELEVANT_ROLES = new Set(["user", "assistant"]);

interface TranscriptEntry {
  type?: string;
  role?: string;
  message?: { role?: string; content?: unknown };
  [key: string]: unknown;
}

export interface ClaudeSessionSummary {
  sessionFile: string;
  totalEntries: number;
  relevantEntries: number;
  transcript: Array<{ type: string; role?: string; contentPreview: string }>;
}

export interface CursorSessionSummary {
  sessionId: string;
  sessionFile: string;
  totalEntries: number;
  relevantEntries: number;
  transcript: Array<{ role: string; contentPreview: string }>;
}

type ClaudeSessionResult =
  | { ok: true; data: ClaudeSessionSummary }
  | { ok: false; error: string; path?: string };

type CursorSessionResult =
  | { ok: true; data: CursorSessionSummary }
  | { ok: false; error: string; path?: string; available?: string[] };

/** Extract a concise content preview from a transcript entry. */
function getContentPreview(entry: TranscriptEntry): string {
  const content = entry.message?.content;
  if (typeof content === "string") {
    return content.length > 500 ? content.slice(0, 500) + "..." : content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        const text = b.text as string;
        parts.push(text.length > 300 ? text.slice(0, 300) + "..." : text);
      } else if (b.type === "tool_use") {
        parts.push(`[tool_use: ${b.name}]`);
      } else if (b.type === "tool_result") {
        parts.push(
          `[tool_result: ${String(b.tool_use_id ?? "").slice(0, 20)}]`
        );
      }
    }
    return parts.join(" | ");
  }
  return "";
}

export interface ReadSessionOptions {
  maxEntries?: number;
}

export interface ReadCursorSessionOptions extends ReadSessionOptions {
  sessionId?: string;
}

/**
 * Read the most recent Claude Code session transcript for a project.
 * Falls back to cwd when no project root is found.
 */
export async function readClaudeCodeSession(
  projectRoot: string | null,
  options?: ReadSessionOptions
): Promise<ClaudeSessionResult> {
  const limit = options?.maxEntries ?? 200;
  const encodedPath = await encodeProjectPath(projectRoot ?? process.cwd());
  const projectsDir = join(homedir(), ".claude", "projects", encodedPath);

  let files: string[];
  try {
    files = readdirSync(projectsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ name: f, mtime: statSync(join(projectsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((f) => f.name);
  } catch {
    return { ok: false, error: "No session files found", path: projectsDir };
  }

  if (files.length === 0) {
    return {
      ok: false,
      error: "No JSONL session files found",
      path: projectsDir,
    };
  }

  const sessionFile = join(projectsDir, files[0]);
  let entries: TranscriptEntry[];
  try {
    const raw = await Bun.file(sessionFile).text();
    entries = Bun.JSONL.parse(raw) as TranscriptEntry[];
  } catch {
    return {
      ok: false,
      error: "Failed to read session file",
      path: sessionFile,
    };
  }

  const relevant: ClaudeSessionSummary["transcript"] = [];
  for (const entry of entries) {
    if (!RELEVANT_TYPES.has(entry.type ?? "")) continue;
    relevant.push({
      type: entry.type!,
      role: entry.message?.role,
      contentPreview: getContentPreview(entry),
    });
  }

  const trimmed = relevant.length > limit ? relevant.slice(-limit) : relevant;
  return {
    ok: true,
    data: {
      sessionFile: basename(sessionFile),
      totalEntries: entries.length,
      relevantEntries: relevant.length,
      transcript: trimmed,
    },
  };
}

/**
 * Read a Cursor agent session transcript for a project.
 * Falls back to cwd when no project root is found.
 */
export async function readCursorSession(
  projectRoot: string | null,
  options?: ReadCursorSessionOptions
): Promise<CursorSessionResult> {
  const limit = options?.maxEntries ?? 200;
  const encodedPath = await encodeProjectPath(projectRoot ?? process.cwd());
  const transcriptsDir = join(
    homedir(),
    ".cursor",
    "projects",
    encodedPath,
    "agent-transcripts"
  );

  let sessionDirs: Array<{ name: string; mtime: number }>;
  try {
    sessionDirs = readdirSync(transcriptsDir)
      .map((name) => {
        const fullPath = join(transcriptsDir, name);
        try {
          const stat = statSync(fullPath);
          return stat.isDirectory() ? { name, mtime: stat.mtimeMs } : null;
        } catch {
          return null;
        }
      })
      .filter((d): d is { name: string; mtime: number } => d !== null)
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return {
      ok: false,
      error: "No Cursor agent-transcripts directory found",
      path: transcriptsDir,
    };
  }

  if (sessionDirs.length === 0) {
    return {
      ok: false,
      error: "No session directories found",
      path: transcriptsDir,
    };
  }

  const targetDir = options?.sessionId
    ? sessionDirs.find((d) => d.name === options.sessionId)
    : sessionDirs[0];

  if (!targetDir) {
    return {
      ok: false,
      error: `Session not found: ${options?.sessionId}`,
      available: sessionDirs.map((d) => d.name),
    };
  }

  const sessionFile = join(
    transcriptsDir,
    targetDir.name,
    `${targetDir.name}.jsonl`
  );
  let entries: TranscriptEntry[];
  try {
    const raw = await Bun.file(sessionFile).text();
    entries = Bun.JSONL.parse(raw) as TranscriptEntry[];
  } catch {
    return {
      ok: false,
      error: "Failed to read session file",
      path: sessionFile,
    };
  }

  const relevant: CursorSessionSummary["transcript"] = [];
  for (const entry of entries) {
    if (!RELEVANT_ROLES.has(entry.role ?? "")) continue;
    relevant.push({
      role: entry.role!,
      contentPreview: getContentPreview(entry),
    });
  }

  const trimmed = relevant.length > limit ? relevant.slice(-limit) : relevant;
  return {
    ok: true,
    data: {
      sessionId: targetDir.name,
      sessionFile: basename(sessionFile),
      totalEntries: entries.length,
      relevantEntries: relevant.length,
      transcript: trimmed,
    },
  };
}
