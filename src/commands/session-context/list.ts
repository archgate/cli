// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { exitWith, handleCommandError } from "../../helpers/exit";
import { logError } from "../../helpers/log";
import { formatJSON } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import {
  type SessionListResult,
  listClaudeCodeSessions,
  listCursorSessions,
} from "../../helpers/session-context";
import { listCopilotSessions } from "../../helpers/session-context-copilot";
import { listOpencodeSessions } from "../../helpers/session-context-opencode";

const EDITORS = ["claude-code", "copilot", "cursor", "opencode"] as const;
type SessionEditor = (typeof EDITORS)[number];

const editorOption = new Option(
  "--editor <editor>",
  "only list sessions for this editor (default: all editors)"
).choices(EDITORS);

/**
 * Dispatch to the editor's list helper. Resolved per call (not via a
 * module-level map) so the live import bindings are honored.
 */
function listFor(
  editor: SessionEditor,
  projectRoot: string | null
): SessionListResult | Promise<SessionListResult> {
  switch (editor) {
    case "claude-code":
      return listClaudeCodeSessions(projectRoot);
    case "copilot":
      return listCopilotSessions(projectRoot);
    case "cursor":
      return listCursorSessions(projectRoot);
    case "opencode":
      return listOpencodeSessions(projectRoot);
  }
}

export function registerListSessionContextCommand(parent: Command) {
  parent
    .command("list")
    .description("List available sessions for the project")
    .addOption(editorOption)
    .action(async (opts) => {
      try {
        const projectRoot = findProjectRoot();

        if (opts.editor) {
          const result = await listFor(opts.editor, projectRoot);
          if (!result.ok) {
            logError(result.error);
            await exitWith(1);
            return;
          }
          console.log(formatJSON(result.data));
          return;
        }

        // No --editor: aggregate every editor's sessions for the project.
        // Editors whose store is absent report their error instead of
        // failing the whole command — the aggregate view is informational.
        const editors: Record<
          string,
          { sessions: unknown[] } | { error: string }
        > = {};
        for (const editor of EDITORS) {
          // oxlint-disable-next-line no-await-in-loop -- sequential on purpose: four cheap local reads, deterministic output order
          const result = await listFor(editor, projectRoot);
          editors[editor] = result.ok
            ? { sessions: result.data.sessions }
            : { error: result.error };
        }
        console.log(formatJSON({ editors }));
      } catch (err) {
        await handleCommandError(err);
      }
    });
}
