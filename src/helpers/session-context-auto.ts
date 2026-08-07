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

interface ReadOptions {
  maxEntries?: number;
  sessionId?: string;
  root?: boolean;
}

/**
 * Per-editor readers. Keying by `Record<DetectedHarness, …>` makes a newly
 * added editor a compile error here, so exhaustiveness needs no runtime
 * fallback branch. opencode's readers are synchronous, and it is the only
 * editor that understands `root` — it alone has a parent/child session graph.
 */
const LISTERS: Record<
  DetectedHarness,
  (projectRoot: string | null) => SessionListResult | Promise<SessionListResult>
> = {
  "claude-code": listClaudeCodeSessions,
  copilot: listCopilotSessions,
  cursor: listCursorSessions,
  opencode: listOpencodeSessions,
};

const READERS: Record<
  DetectedHarness,
  (
    projectRoot: string | null,
    options: ReadOptions
  ) => ReadResult | Promise<ReadResult>
> = {
  "claude-code": async (root, o) =>
    readClaudeCodeSession(root, {
      maxEntries: o.maxEntries,
      sessionId: o.sessionId,
    }),
  copilot: async (root, o) =>
    readCopilotSession(root, {
      maxEntries: o.maxEntries,
      sessionId: o.sessionId,
    }),
  cursor: async (root, o) =>
    readCursorSession(root, {
      maxEntries: o.maxEntries,
      sessionId: o.sessionId,
    }),
  opencode: (root, o) => readOpencodeSession(root, o),
};

async function listFor(
  editor: DetectedHarness,
  projectRoot: string | null
): Promise<SessionListResult> {
  return LISTERS[editor](projectRoot);
}

async function readFor(
  editor: DetectedHarness,
  projectRoot: string | null,
  options: ReadOptions
): Promise<ReadResult> {
  return READERS[editor](projectRoot, options);
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
