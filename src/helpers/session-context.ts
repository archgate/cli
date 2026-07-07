// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { z } from "zod";

import type { EditorTarget } from "./init-project";
import { isWSL, toWindowsPath } from "./platform";

/**
 * Encode a project root path into the directory name used by Claude/Cursor
 * for storing session files under `~/.claude/projects/` or `~/.cursor/projects/`.
 *
 * Replaces path separators (`\`, `/`) and dots (`.`) with dashes (`-`).
 * Drive-letter colons (`:`) are handled per-tool: Claude Code replaces them
 * with dashes while Cursor strips them entirely.
 *
 * Examples (target = "claude", the default):
 * - `/home/user/project`          → `-home-user-project`
 * - `C:\Users\user\project`       → `C--Users-user-project`
 * - `E:\foo\.claude\worktrees\x`  → `E--foo--claude-worktrees-x`
 *
 * Examples (target = "cursor"):
 * - `/home/user/project`          → `-home-user-project`
 * - `C:\Users\user\project`       → `C-Users-user-project`
 * - `E:\foo\.claude\worktrees\x`  → `E-foo--claude-worktrees-x`
 *
 * In WSL, converts to the Windows path first so the encoded name matches
 * what the Windows-side editor uses.
 */
export async function encodeProjectPath(
  projectRoot: string,
  target?: EditorTarget
): Promise<string> {
  let raw = projectRoot;
  if (isWSL()) {
    const winPath = await toWindowsPath(projectRoot);
    if (winPath) {
      raw = winPath;
    }
  }
  const colonReplacement = target === "cursor" ? "" : "-";
  return raw
    .replaceAll("\\", "-")
    .replaceAll("/", "-")
    .replaceAll(":", colonReplacement)
    .replaceAll(".", "-");
}

const RELEVANT_TYPES = new Set(["user", "assistant"]);
export const RELEVANT_ROLES = new Set(["user", "assistant"]);

export const TranscriptEntrySchema = z.object({
  type: z.string().optional(),
  role: z.string().optional(),
  message: z
    .object({ role: z.string().optional(), content: z.unknown() })
    .optional(),
});

export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

interface ClaudeSessionSummary {
  sessionFile: string;
  totalEntries: number;
  relevantEntries: number;
  transcript: Array<{ type: string; role?: string; contentPreview: string }>;
}

/** One entry in a list result: session id + last-update timestamp. */
export interface SessionListEntry {
  id: string;
  /** Session title — only populated by editors that store one (opencode). */
  title?: string;
  updatedAt: string;
}

export type SessionListResult =
  | { ok: true; data: { sessions: SessionListEntry[] } }
  | { ok: false; error: string; path?: string };

interface CursorSessionSummary {
  sessionId: string;
  sessionFile: string;
  totalEntries: number;
  relevantEntries: number;
  transcript: Array<{ role: string; contentPreview: string }>;
}

type ClaudeSessionResult =
  | { ok: true; data: ClaudeSessionSummary }
  | { ok: false; error: string; path?: string; available?: string[] };

type CursorSessionResult =
  | { ok: true; data: CursorSessionSummary }
  | { ok: false; error: string; path?: string; available?: string[] };

/** Extract a concise content preview from a transcript entry. */
export function getContentPreview(entry: TranscriptEntry): string {
  const content = entry.message?.content;
  if (typeof content === "string") {
    return content.length > 500 ? content.slice(0, 500) + "..." : content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      if (!("type" in block)) continue;
      if (
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        const text = block.text;
        parts.push(text.length > 300 ? text.slice(0, 300) + "..." : text);
      } else if (block.type === "tool_use" && "name" in block) {
        parts.push(`[tool_use: ${block.name}]`);
      } else if (block.type === "tool_result" && "tool_use_id" in block) {
        parts.push(
          `[tool_result: ${String(block.tool_use_id ?? "").slice(0, 20)}]`
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

interface ReadClaudeSessionOptions extends ReadSessionOptions {
  sessionId?: string;
}

interface ReadCursorSessionOptions extends ReadSessionOptions {
  sessionId?: string;
}

/** Resolve the Claude Code projects dir for a project root. */
async function claudeProjectsDir(projectRoot: string | null): Promise<string> {
  const encodedPath = await encodeProjectPath(projectRoot ?? process.cwd());
  return join(homedir(), ".claude", "projects", encodedPath);
}

/**
 * Enumerate Claude Code session files for a project, most recent first.
 * Returns null when the projects directory cannot be read.
 */
function enumerateClaudeSessionFiles(
  projectsDir: string
): Array<{ name: string; mtime: number }> | null {
  try {
    return readdirSync(projectsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ name: f, mtime: statSync(join(projectsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return null;
  }
}

/**
 * List Claude Code sessions for a project, most recent first.
 * Session ids are the JSONL file basenames (without extension).
 */
export async function listClaudeCodeSessions(
  projectRoot: string | null
): Promise<SessionListResult> {
  const projectsDir = await claudeProjectsDir(projectRoot);
  const files = enumerateClaudeSessionFiles(projectsDir);
  if (files === null) {
    return { ok: false, error: "No session files found", path: projectsDir };
  }
  return {
    ok: true,
    data: {
      sessions: files.map((f) => ({
        id: basename(f.name, ".jsonl"),
        updatedAt: new Date(f.mtime).toISOString(),
      })),
    },
  };
}

/**
 * Read the most recent Claude Code session transcript for a project —
 * normally the conversation that is running right now. Pass `sessionId`
 * (from `listClaudeCodeSessions`) to read an earlier session instead.
 * Falls back to cwd when no project root is found.
 */
export async function readClaudeCodeSession(
  projectRoot: string | null,
  options?: ReadClaudeSessionOptions
): Promise<ClaudeSessionResult> {
  const limit = options?.maxEntries ?? 200;
  const projectsDir = await claudeProjectsDir(projectRoot);

  const allFiles = enumerateClaudeSessionFiles(projectsDir);
  if (allFiles === null) {
    return { ok: false, error: "No session files found", path: projectsDir };
  }
  const files = allFiles.map((f) => f.name);

  if (files.length === 0) {
    return {
      ok: false,
      error: "No JSONL session files found",
      path: projectsDir,
    };
  }

  const targetName = options?.sessionId
    ? files.find((f) => f === `${options.sessionId}.jsonl`)
    : files[0];

  if (!targetName) {
    return {
      ok: false,
      error: `Session not found: ${options?.sessionId ?? ""}`,
      path: projectsDir,
      available: files.map((f) => basename(f, ".jsonl")),
    };
  }

  const sessionFile = join(projectsDir, targetName);
  let entries: TranscriptEntry[];
  try {
    const raw = await Bun.file(sessionFile).text();
    entries = z.array(TranscriptEntrySchema).parse(Bun.JSONL.parse(raw));
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

/** Resolve the Cursor agent-transcripts dir for a project root. */
async function cursorTranscriptsDir(
  projectRoot: string | null
): Promise<string> {
  const encodedPath = await encodeProjectPath(
    projectRoot ?? process.cwd(),
    "cursor"
  );
  return join(
    homedir(),
    ".cursor",
    "projects",
    encodedPath,
    "agent-transcripts"
  );
}

/**
 * Enumerate Cursor session directories for a project, most recent first.
 * Returns null when the transcripts directory cannot be read.
 */
function enumerateCursorSessionDirs(
  transcriptsDir: string
): Array<{ name: string; mtime: number }> | null {
  try {
    return readdirSync(transcriptsDir)
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
    return null;
  }
}

/** List Cursor agent sessions for a project, most recent first. */
export async function listCursorSessions(
  projectRoot: string | null
): Promise<SessionListResult> {
  const transcriptsDir = await cursorTranscriptsDir(projectRoot);
  const sessionDirs = enumerateCursorSessionDirs(transcriptsDir);
  if (sessionDirs === null) {
    return {
      ok: false,
      error: "No Cursor agent-transcripts directory found",
      path: transcriptsDir,
    };
  }
  return {
    ok: true,
    data: {
      sessions: sessionDirs.map((d) => ({
        id: d.name,
        updatedAt: new Date(d.mtime).toISOString(),
      })),
    },
  };
}

/**
 * Read the most recent Cursor agent session transcript for a project —
 * normally the conversation that is running right now. Pass `sessionId`
 * (from `listCursorSessions`) to read an earlier session instead.
 * Falls back to cwd when no project root is found.
 */
export async function readCursorSession(
  projectRoot: string | null,
  options?: ReadCursorSessionOptions
): Promise<CursorSessionResult> {
  const limit = options?.maxEntries ?? 200;
  const transcriptsDir = await cursorTranscriptsDir(projectRoot);

  const sessionDirs = enumerateCursorSessionDirs(transcriptsDir);
  if (sessionDirs === null) {
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
      error: `Session not found: ${options?.sessionId ?? ""}`,
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
    entries = z.array(TranscriptEntrySchema).parse(Bun.JSONL.parse(raw));
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
