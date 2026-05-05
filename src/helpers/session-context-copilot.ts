import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { logDebug } from "./log";
import { copilotSessionStateDir } from "./paths";
import { isWindows } from "./platform";
import {
  type ReadSessionOptions,
  type TranscriptEntry,
  getContentPreview,
} from "./session-context";

export interface CopilotSessionSummary {
  sessionId: string;
  sessionFile: string;
  totalEntries: number;
  relevantEntries: number;
  transcript: Array<{ role: string; contentPreview: string }>;
}

export interface ReadCopilotSessionOptions extends ReadSessionOptions {
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

/**
 * Read a Copilot CLI session transcript for a project.
 *
 * Copilot CLI stores sessions under `~/.copilot/session-state/<uuid>/`.
 * Each session directory contains:
 * - `workspace.yaml` — metadata with a `cwd` field for project matching
 * - `events.jsonl`   — JSONL event log with conversation events
 *
 * Sessions are matched by comparing the `cwd` field in workspace.yaml
 * to the provided project root.
 */
export async function readCopilotSession(
  projectRoot: string | null,
  options?: ReadCopilotSessionOptions
): Promise<CopilotSessionResult> {
  const limit = options?.maxEntries ?? 200;
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
  interface SessionMatch {
    name: string;
    mtime: number;
  }
  const matching: SessionMatch[] = [];
  const allSessionIds: string[] = [];

  for (const dir of allDirs) {
    allSessionIds.push(dir.name);
    const yamlPath = join(stateDir, dir.name, "workspace.yaml");
    try {
      // oxlint-disable-next-line no-await-in-loop -- sequential read needed: each session's YAML determines project match
      const raw = await Bun.file(yamlPath).text();
      const meta = Bun.YAML.parse(raw) as Record<string, unknown>;
      const cwd = typeof meta.cwd === "string" ? meta.cwd : null;
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

  // 3. Select session by ID or most recent
  const target = options?.sessionId
    ? matching.find((s) => s.name === options.sessionId)
    : matching[0];

  if (!target) {
    return {
      ok: false,
      error: `Session not found: ${options?.sessionId}`,
      available: matching.map((s) => s.name),
    };
  }

  // 4. Read events.jsonl
  const eventsFile = join(stateDir, target.name, "events.jsonl");
  let rawEntries: Array<Record<string, unknown>>;
  try {
    const raw = await Bun.file(eventsFile).text();
    rawEntries = Bun.JSONL.parse(raw) as Array<Record<string, unknown>>;
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
    const normalized: TranscriptEntry = {
      message: { content: (event.data as Record<string, unknown>)?.content },
    };
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
