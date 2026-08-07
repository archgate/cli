// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * session-context-auto.ts — Read a session transcript for whichever AI editor
 * is running the CLI, resolved by {@link detectHarness}.
 *
 * Dispatches to the per-editor readers unchanged and adds a `detection` block
 * to their payload so the caller can see which editor answered and whether
 * the session was pinned or chosen by recency.
 */

import type { DetectedHarness } from "./harness-detect";
import { detectHarness } from "./harness-detect";
import {
  listClaudeCodeSessions,
  listCursorSessions,
  readClaudeCodeSession,
  readCursorSession,
} from "./session-context";
import type { SessionListEntry, SessionListResult } from "./session-context";
import {
  listCopilotSessions,
  readCopilotSession,
} from "./session-context-copilot";
import {
  listOpencodeSessions,
  readOpencodeSession,
} from "./session-context-opencode";
import { UserError } from "./user-error";

/** How the returned session was chosen. */
export type SessionSelection = "pinned" | "recent" | "explicit";

export interface AutoDetectionInfo {
  editor: DetectedHarness;
  via: string;
  session: SessionSelection;
  candidates: DetectedHarness[];
}

type ReadResult =
  | Awaited<ReturnType<typeof readClaudeCodeSession>>
  | Awaited<ReturnType<typeof readCopilotSession>>
  | Awaited<ReturnType<typeof readCursorSession>>
  | ReturnType<typeof readOpencodeSession>;

type AutoReadResult =
  | { ok: true; detection: AutoDetectionInfo; data: object }
  | { ok: false; error: string; path?: string; available?: string[] };

type AutoListResult =
  | {
      ok: true;
      detection: Omit<AutoDetectionInfo, "session">;
      sessions: SessionListEntry[];
    }
  | { ok: false; error: string; path?: string };

interface ResolvedEditor {
  editor: DetectedHarness;
  via: string;
  candidates: DetectedHarness[];
  envSessionId: string | null;
}

/**
 * Resolve which editor to read, preferring an explicit `--editor` over the
 * environment.
 *
 * @param explicit - Editor named on the command line, when given.
 * @throws {UserError} When nothing was named and no harness marker is present
 * — archgate was run from a plain shell rather than inside an AI editor.
 */
function requireEditor(explicit?: DetectedHarness): ResolvedEditor {
  const detection = detectHarness();

  if (explicit !== undefined) {
    return {
      editor: explicit,
      via: "--editor",
      candidates: detection.candidates,
      // A published session id belongs to the harness that published it, so
      // it may only pin when the named editor is that same harness.
      envSessionId:
        detection.editor === explicit ? detection.envSessionId : null,
    };
  }

  if (detection.editor === null || detection.via === null) {
    throw new UserError(
      "Could not detect the AI editor from the environment.",
      "Name it with --editor <claude-code|copilot|cursor|opencode>."
    );
  }

  return {
    editor: detection.editor,
    via: detection.via,
    candidates: detection.candidates,
    envSessionId: detection.envSessionId,
  };
}

/**
 * Reject an editor the switches below do not handle. Typing the parameter as
 * `never` turns a newly added {@link DetectedHarness} into a compile error
 * rather than a silent fallthrough.
 */
function unhandledEditor(editor: never): never {
  throw new Error(`Unhandled editor: ${String(editor)}`);
}

/** List sessions for one editor. opencode's reader is synchronous. */
async function listFor(
  editor: DetectedHarness,
  projectRoot: string | null
): Promise<SessionListResult> {
  switch (editor) {
    case "claude-code":
      return listClaudeCodeSessions(projectRoot);
    case "copilot":
      return listCopilotSessions(projectRoot);
    case "cursor":
      return listCursorSessions(projectRoot);
    case "opencode":
      return listOpencodeSessions(projectRoot);
    default:
      return unhandledEditor(editor);
  }
}

/**
 * Read one session for one editor. opencode's reader is synchronous, and is
 * the only one that understands `root` — it alone has a parent/child session
 * graph.
 */
async function readFor(
  editor: DetectedHarness,
  projectRoot: string | null,
  options: { maxEntries?: number; sessionId?: string; root?: boolean }
): Promise<ReadResult> {
  const { root, ...shared } = options;
  switch (editor) {
    case "claude-code":
      return readClaudeCodeSession(projectRoot, shared);
    case "copilot":
      return readCopilotSession(projectRoot, shared);
    case "cursor":
      return readCursorSession(projectRoot, shared);
    case "opencode":
      return readOpencodeSession(projectRoot, { ...shared, root });
    default:
      return unhandledEditor(editor);
  }
}

/**
 * Reject `--root` for editors without a session graph, rather than accepting
 * a flag that would silently do nothing.
 *
 * @throws {UserError} When `root` is set for any editor but opencode.
 */
function assertRootSupported(editor: DetectedHarness, root?: boolean): void {
  if (root !== true || editor === "opencode") return;
  throw new UserError(
    `--root applies only to opencode, which has parent/child sessions; the ${editor} reader has none.`
  );
}

/**
 * Confirm an environment-supplied session id names a session that exists for
 * this project, returning it only then.
 *
 * Readers hard-fail on an unknown `sessionId` and never fall back on their
 * own, so probing the project-scoped list first keeps a stale or unrelated
 * id harmless: it degrades to recency.
 *
 * @returns The id when it matches a listed session, otherwise undefined.
 */
async function resolvePinnedId(
  editor: DetectedHarness,
  projectRoot: string | null,
  envSessionId: string | null
): Promise<string | undefined> {
  if (envSessionId === null) return undefined;
  const listed = await listFor(editor, projectRoot);
  if (!listed.ok) return undefined;
  return listed.data.sessions.some((s) => s.id === envSessionId)
    ? envSessionId
    : undefined;
}

/**
 * Read the current session, pinning the exact one when the harness published
 * a usable id.
 *
 * @param projectRoot - Project to read sessions for; `null` falls back to cwd.
 * @param options - `editor` overrides detection; `maxEntries` caps returned
 * transcript entries; `root` resolves an opencode child session to its
 * top-level ancestor.
 * @throws {UserError} When no editor was named and none could be detected.
 */
export async function readAutoSession(
  projectRoot: string | null,
  options?: { maxEntries?: number; editor?: DetectedHarness; root?: boolean }
): Promise<AutoReadResult> {
  const harness = requireEditor(options?.editor);
  assertRootSupported(harness.editor, options?.root);
  const pinned = await resolvePinnedId(
    harness.editor,
    projectRoot,
    harness.envSessionId
  );

  const result = await readFor(harness.editor, projectRoot, {
    maxEntries: options?.maxEntries,
    sessionId: pinned,
    root: options?.root,
  });

  if (!result.ok) return result;

  return {
    ok: true,
    detection: {
      editor: harness.editor,
      via: harness.via,
      session: pinned === undefined ? "recent" : "pinned",
      candidates: harness.candidates,
    },
    data: result.data,
  };
}

/**
 * Read a specific session by id. An explicit id always wins over the one
 * published by the environment.
 *
 * @throws {UserError} When no editor was named and none could be detected.
 */
export async function readAutoSessionById(
  projectRoot: string | null,
  sessionId: string,
  options?: { maxEntries?: number; editor?: DetectedHarness; root?: boolean }
): Promise<AutoReadResult> {
  const harness = requireEditor(options?.editor);
  assertRootSupported(harness.editor, options?.root);
  const result = await readFor(harness.editor, projectRoot, {
    maxEntries: options?.maxEntries,
    sessionId,
    root: options?.root,
  });

  if (!result.ok) return result;

  return {
    ok: true,
    detection: {
      editor: harness.editor,
      via: harness.via,
      session: "explicit",
      candidates: harness.candidates,
    },
    data: result.data,
  };
}

/**
 * List sessions for the named or detected editor.
 *
 * @throws {UserError} When no editor was named and none could be detected.
 */
export async function listAutoSessions(
  projectRoot: string | null,
  options?: { editor?: DetectedHarness }
): Promise<AutoListResult> {
  const harness = requireEditor(options?.editor);
  const result = await listFor(harness.editor, projectRoot);

  if (!result.ok) return result;

  return {
    ok: true,
    detection: {
      editor: harness.editor,
      via: harness.via,
      candidates: harness.candidates,
    },
    sessions: result.data.sessions,
  };
}
