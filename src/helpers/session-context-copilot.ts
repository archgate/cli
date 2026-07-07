// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { z } from "zod";

import { logDebug } from "./log";
import { copilotSessionStateDir } from "./paths";
import { isWindows } from "./platform";
import {
  type ReadSessionOptions,
  type SessionListResult,
  type TranscriptEntry,
  getContentPreview,
} from "./session-context";

const WorkspaceMetaSchema = z.object({ cwd: z.string().optional() });

const CopilotEventSchema = z.object({
  type: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const CopilotEventsSchema = z.array(CopilotEventSchema);

interface CopilotSessionSummary {
  sessionId: string;
  sessionFile: string;
  totalEntries: number;
  relevantEntries: number;
  transcript: Array<{ role: string; contentPreview: string }>;
}

interface ReadCopilotSessionOptions extends ReadSessionOptions {
  sessionId?: string;
}

type CopilotSessionResult =
  | { ok: true; data: CopilotSessionSummary }
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

const COPILOT_RELEVANT_TYPES = new Set(["user.message", "assistant.message"]);

interface CopilotSessionMatch {
  name: string;
  mtime: number;
}

type CopilotMatchResult =
  | { ok: true; matching: CopilotSessionMatch[]; stateDir: string }
  | { ok: false; error: string; path?: string; available?: string[] };

/**
 * Find Copilot CLI sessions matching a project, most recent first.
 *
 * Copilot CLI stores sessions under `~/.copilot/session-state/<uuid>/`.
 * Each session directory contains:
 * - `workspace.yaml` — metadata with a `cwd` field for project matching
 * - `events.jsonl`   — JSONL event log with conversation events
 *
 * Sessions are matched by comparing the `cwd` field in workspace.yaml
 * to the provided project root.
 */
async function findMatchingCopilotSessions(
  projectRoot: string | null
): Promise<CopilotMatchResult> {
  const stateDir = copilotSessionStateDir();
  const normalizedProjectRoot = normalizePath(projectRoot ?? process.cwd());

  // 1. List all session UUID directories
  let allDirs: Array<{ name: string; mtime: number }>;
  try {
    allDirs = readdirSync(stateDir)
      .map((name) => {
        const fullPath = join(stateDir, name);
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
      error: "No Copilot CLI session-state directory found",
      path: stateDir,
    };
  }

  if (allDirs.length === 0) {
    return { ok: false, error: "No session directories found", path: stateDir };
  }

  // 2. Parse workspace.yaml for each session to match by cwd
  const matching: CopilotSessionMatch[] = [];
  const allSessionIds: string[] = [];

  for (const dir of allDirs) {
    allSessionIds.push(dir.name);
    const yamlPath = join(stateDir, dir.name, "workspace.yaml");
    try {
      // oxlint-disable-next-line no-await-in-loop -- sequential read needed: each session's YAML determines project match
      const raw = await Bun.file(yamlPath).text();
      const metaResult = WorkspaceMetaSchema.safeParse(Bun.YAML.parse(raw));
      if (!metaResult.success) continue;
      const cwd = metaResult.data.cwd ?? null;
      if (cwd && normalizePath(cwd) === normalizedProjectRoot) {
        matching.push({ name: dir.name, mtime: dir.mtime });
      }
    } catch {
      logDebug(`Skipping session ${dir.name}: cannot read workspace.yaml`);
    }
  }

  if (matching.length === 0) {
    return {
      ok: false,
      error: "No Copilot CLI sessions found for this project",
      path: stateDir,
      available: allSessionIds,
    };
  }

  return { ok: true, matching, stateDir };
}

/** List Copilot CLI sessions for a project, most recent first. */
export async function listCopilotSessions(
  projectRoot: string | null
): Promise<SessionListResult> {
  const found = await findMatchingCopilotSessions(projectRoot);
  if (!found.ok) {
    return { ok: false, error: found.error, path: found.path };
  }
  return {
    ok: true,
    data: {
      sessions: found.matching.map((s) => ({
        id: s.name,
        updatedAt: new Date(s.mtime).toISOString(),
      })),
    },
  };
}

/**
 * Read the most recent Copilot CLI session transcript for a project —
 * normally the conversation that is running right now. Pass `sessionId`
 * (from `listCopilotSessions`) to read an earlier session instead.
 */
export async function readCopilotSession(
  projectRoot: string | null,
  options?: ReadCopilotSessionOptions
): Promise<CopilotSessionResult> {
  const limit = options?.maxEntries ?? 200;

  const found = await findMatchingCopilotSessions(projectRoot);
  if (!found.ok) {
    return found;
  }
  const { matching, stateDir } = found;

  // 3. Select session by ID or most recent
  const target = options?.sessionId
    ? matching.find((s) => s.name === options.sessionId)
    : matching[0];

  if (!target) {
    return {
      ok: false,
      error: `Session not found: ${options?.sessionId ?? ""}`,
      available: matching.map((s) => s.name),
    };
  }

  // 4. Read events.jsonl
  const eventsFile = join(stateDir, target.name, "events.jsonl");
  let rawEntries: z.infer<typeof CopilotEventsSchema>;
  try {
    const raw = await Bun.file(eventsFile).text();
    rawEntries = CopilotEventsSchema.parse(Bun.JSONL.parse(raw));
  } catch {
    return {
      ok: false,
      error: "Session exists but has no conversation transcript",
      path: eventsFile,
    };
  }

  // 5. Filter to user/assistant events and normalize to TranscriptEntry shape
  const relevant: CopilotSessionSummary["transcript"] = [];
  for (const event of rawEntries) {
    const eventType = String(event.type ?? "");
    if (!COPILOT_RELEVANT_TYPES.has(eventType)) continue;
    const role = eventType === "user.message" ? "user" : "assistant";
    // Normalize to TranscriptEntry shape so getContentPreview works
    const content = event.data?.content;
    const normalized: TranscriptEntry = { message: { content } };
    relevant.push({ role, contentPreview: getContentPreview(normalized) });
  }

  const trimmed = relevant.length > limit ? relevant.slice(-limit) : relevant;
  return {
    ok: true,
    data: {
      sessionId: target.name,
      sessionFile: "events.jsonl",
      totalEntries: rawEntries.length,
      relevantEntries: relevant.length,
      transcript: trimmed,
    },
  };
}
