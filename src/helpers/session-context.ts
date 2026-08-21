// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import { z } from "zod";

import { readTextIfExists } from "./fs-read";
import type { EditorTarget } from "./init-project";
import { isWindows, isWSL, toWindowsPath } from "./platform";

/**
 * Normalize a path for cross-platform comparison: resolve to absolute, use
 * `/` separators, and lowercase on Windows where the filesystem is
 * case-insensitive. Readers compare a session's recorded working directory
 * against the project root through this.
 */
export function normalizePath(p: string): string {
  const resolved = resolve(p).replaceAll("\\", "/");
  return isWindows() ? resolved.toLowerCase() : resolved;
}

/**
 * Failure for a session file that is discovered but then unreadable, which a
 * session removed between discovery and the read produces.
 */
export function sessionReadFailure(file: string) {
  return {
    ok: false as const,
    error: "Failed to read session file",
    path: file,
  };
}

/**
 * Slugify a project root the way cursor-agent names its directory under
 * `~/.cursor/projects/`: each non-alphanumeric run becomes one dash, and the
 * ends are trimmed. Collapsing is what resolves a dot-segment — `\.claude\`
 * yields `-claude-`, so a worktree under `.claude/` finds Cursor's directory.
 */
function slugifyCursorPath(raw: string): string {
  return raw
    .replaceAll(/[^a-zA-Z0-9]/gu, "-")
    .replaceAll(/-+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
}

/**
 * Encode a project root into the session-directory name under
 * `~/.claude/projects/` or `~/.cursor/projects/`. Each editor's own encoding
 * must be matched exactly: Claude Code keeps every separator it maps to a
 * dash (`C:\Users\x` → `C--Users-x`), while Cursor collapses runs and trims
 * (`C-Users-x`). In WSL, converts to the Windows path first.
 */
export async function encodeProjectPath(
  projectRoot: string,
  target?: EditorTarget
): Promise<string> {
  let raw = projectRoot;
  if (isWSL()) {
    const winPath = await toWindowsPath(projectRoot);
    if (winPath !== null && winPath !== "") {
      raw = winPath;
    }
  }
  if (target === "cursor") return slugifyCursorPath(raw);
  return raw
    .replaceAll("\\", "-")
    .replaceAll("/", "-")
    .replaceAll(":", "-")
    .replaceAll(".", "-");
}

const RELEVANT_TYPES = new Set(["user", "assistant"]);
export const RELEVANT_ROLES = new Set(["user", "assistant"]);

const TextBlockSchema = z.object({ type: z.literal("text"), text: z.string() });
const ToolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  name: z.string(),
});
const ToolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
});
// Catch-all for block types we don't inspect (thinking, image, etc.)
const UnknownBlockSchema = z.object({ type: z.string() }).loose();

const ContentBlockSchema = z.union([
  TextBlockSchema,
  ToolUseBlockSchema,
  ToolResultBlockSchema,
  UnknownBlockSchema,
]);

type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const MessageContentSchema = z.union([
  z.string(),
  z.array(ContentBlockSchema),
]);

export const TranscriptEntrySchema = z.object({
  type: z.string().default(""),
  role: z.string().default(""),
  message: z
    .object({
      role: z.string().optional(),
      content: MessageContentSchema.optional(),
    })
    .optional(),
});

export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

interface ClaudeSessionSummary {
  sessionFile: string;
  totalEntries: number;
  relevantEntries: number;
  transcript: Array<{ type: string; role?: string; contentPreview: string }>;
}

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

/**
 * Cap `text` at `max` terminal columns, appending an ellipsis when it was cut.
 *
 * `String.slice` counts UTF-16 code units, so a cut inside an emoji leaves a
 * lone surrogate — valid JSON, but a value a non-JS reader of `--json` cannot
 * re-encode to UTF-8. `Bun.sliceAnsi` cuts on grapheme boundaries.
 */
export function truncatePreview(text: string, max: number): string {
  const sliced = Bun.sliceAnsi(text, 0, max);
  return sliced === text ? text : `${sliced}...`;
}

/** Extract a preview string from a single content block, or null for unknown types. */
function parseContentBlock(block: ContentBlock): string | null {
  const text = TextBlockSchema.safeParse(block);
  if (text.success) return truncatePreview(text.data.text, 300);
  const toolUse = ToolUseBlockSchema.safeParse(block);
  if (toolUse.success) return `[tool_use: ${toolUse.data.name}]`;
  const toolResult = ToolResultBlockSchema.safeParse(block);
  if (toolResult.success)
    return `[tool_result: ${toolResult.data.tool_use_id.slice(0, 20)}]`;
  return null;
}

export function getContentPreview(entry: TranscriptEntry): string {
  const content = entry.message?.content;
  if (typeof content === "string") return truncatePreview(content, 500);
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      const parsed = parseContentBlock(block);
      if (parsed !== null && parsed !== "") parts.push(parsed);
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
 * normally the conversation that is running right now.
 *
 * @param projectRoot - Project to read sessions for; `null` falls back to cwd.
 * @param options - `sessionId` (from {@link listClaudeCodeSessions}) selects
 * an earlier session; `maxEntries` caps returned transcript entries.
 * @returns The transcript on success, or a result carrying the reason no
 * session could be read.
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

  const sessionIdFilter = options?.sessionId;
  const targetName =
    sessionIdFilter !== undefined && sessionIdFilter !== ""
      ? files.find((f) => f === `${sessionIdFilter}.jsonl`)
      : files[0];

  if (targetName === undefined || targetName === "") {
    return {
      ok: false,
      error: `Session not found: ${options?.sessionId ?? ""}`,
      path: projectsDir,
      available: files.map((f) => basename(f, ".jsonl")),
    };
  }

  const sessionFile = join(projectsDir, targetName);
  // `.catch` as well as the null: readTextIfExists rejects for a file that
  // exists but cannot be read, which is the case sessionReadFailure names.
  const raw = await readTextIfExists(sessionFile).catch(() => null);
  if (raw === null) return sessionReadFailure(sessionFile);

  let entries: TranscriptEntry[];
  try {
    const parsed = z
      .array(TranscriptEntrySchema)
      .safeParse(Bun.JSONL.parse(raw));
    if (!parsed.success) return sessionReadFailure(sessionFile);
    entries = parsed.data;
  } catch {
    return sessionReadFailure(sessionFile);
  }

  const relevant: ClaudeSessionSummary["transcript"] = [];
  for (const entry of entries) {
    if (!RELEVANT_TYPES.has(entry.type)) continue;
    relevant.push({
      type: entry.type,
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
 * normally the conversation that is running right now.
 *
 * @param projectRoot - Project to read sessions for; `null` falls back to cwd.
 * @param options - `sessionId` (from {@link listCursorSessions}) selects an
 * earlier session; `maxEntries` caps returned transcript entries.
 * @returns The transcript on success, or a result carrying the reason no
 * session could be read.
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

  const sessionIdFilter = options?.sessionId;
  const targetDir =
    sessionIdFilter !== undefined && sessionIdFilter !== ""
      ? sessionDirs.find((d) => d.name === sessionIdFilter)
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
  // `.catch` as well as the null: readTextIfExists rejects for a file that
  // exists but cannot be read, which is the case sessionReadFailure names.
  const raw = await readTextIfExists(sessionFile).catch(() => null);
  if (raw === null) return sessionReadFailure(sessionFile);

  let entries: TranscriptEntry[];
  try {
    const parsed = z
      .array(TranscriptEntrySchema)
      .safeParse(Bun.JSONL.parse(raw));
    if (!parsed.success) return sessionReadFailure(sessionFile);
    entries = parsed.data;
  } catch {
    return sessionReadFailure(sessionFile);
  }

  const relevant: CursorSessionSummary["transcript"] = [];
  for (const entry of entries) {
    if (!RELEVANT_ROLES.has(entry.role)) continue;
    relevant.push({
      role: entry.role,
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
