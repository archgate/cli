// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * harness-detect.ts — Identify which AI editor is running the CLI, from the
 * environment variables that harness injects into the processes it spawns.
 *
 * Distinct from `editor-detect.ts`, which asks whether an editor is
 * *installed*; an installed-but-idle editor must never register here.
 */

import { usableEnv } from "./paths";

export type DetectedHarness = "claude-code" | "copilot" | "cursor" | "opencode";

export interface HarnessDetection {
  /** Winning harness under {@link SIGNALS} precedence, or null when none matched. */
  editor: DetectedHarness | null;
  /** Env var that decided `editor`, for output attribution. */
  via: string | null;
  /** Every harness whose marker is present, in precedence order. */
  candidates: DetectedHarness[];
  /** Session id the winning harness published, when it publishes one. */
  envSessionId: string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface HarnessSignal {
  editor: DetectedHarness;
  /** Presence of any one of these marks the harness as running. */
  markers: string[];
  /** Env var carrying this harness's own session id, when it has one. */
  sessionIdVar?: string;
  /**
   * Require a UUID-shaped session id. Set only for Cursor, whose
   * `getSafeConversationId` rewrites `%` to `_`: lossless for a UUID, but
   * one-way otherwise, where the rewritten value could collide with a
   * different real session id and pin the wrong transcript.
   */
  requireUuidSessionId?: boolean;
}

/**
 * Detection signals in precedence order, applied when a nested setup sets
 * more than one marker (an agent shelling out to another agent). The
 * environment carries no nesting order, so the tie is broken by evidence
 * strength: harnesses that also publish a session id rank above the one that
 * does not. Every match is still reported in `candidates`.
 */
const SIGNALS: HarnessSignal[] = [
  {
    editor: "claude-code",
    markers: ["CLAUDECODE"],
    sessionIdVar: "CLAUDE_CODE_SESSION_ID",
  },
  {
    editor: "copilot",
    markers: ["COPILOT_CLI"],
    sessionIdVar: "COPILOT_AGENT_SESSION_ID",
  },
  {
    editor: "cursor",
    markers: ["CURSOR_AGENT"],
    sessionIdVar: "CURSOR_CONVERSATION_ID",
    requireUuidSessionId: true,
  },
  { editor: "opencode", markers: ["OPENCODE", "OPENCODE_CLIENT"] },
];

/** The env var that marks `signal` as running, or null when none is set. */
function matchedMarker(signal: HarnessSignal): string | null {
  for (const marker of signal.markers) {
    if (usableEnv(Bun.env[marker]) !== null) return marker;
  }
  return null;
}

/**
 * Read a harness's published session id.
 *
 * Routed through `usableEnv` so an empty or literal-"undefined" value becomes
 * null rather than `""` — the session readers treat `sessionId: ""` exactly
 * like `undefined` and silently fall back to recency, which would make an
 * unset variable indistinguishable from a rejected one.
 */
function readSessionId(signal: HarnessSignal): string | null {
  if (signal.sessionIdVar === undefined) return null;
  const value = usableEnv(Bun.env[signal.sessionIdVar]);
  if (value === null) return null;
  if (signal.requireUuidSessionId === true && !UUID_PATTERN.test(value)) {
    return null;
  }
  return value;
}

/**
 * Resolve the AI editor running this process from its environment.
 *
 * @returns The winning harness with the var that identified it and any
 * session id it published; `editor` is null when no marker is present (a
 * plain shell), leaving the caller to require an explicit editor.
 */
export function detectHarness(): HarnessDetection {
  const candidates: DetectedHarness[] = [];
  let winner: { signal: HarnessSignal; via: string } | null = null;

  for (const signal of SIGNALS) {
    const marker = matchedMarker(signal);
    if (marker === null) continue;
    candidates.push(signal.editor);
    winner ??= { signal, via: marker };
  }

  if (winner === null) {
    return { editor: null, via: null, candidates: [], envSessionId: null };
  }

  return {
    editor: winner.signal.editor,
    via: winner.via,
    candidates,
    envSessionId: readSessionId(winner.signal),
  };
}
