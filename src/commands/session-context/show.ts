// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { exitWith, handleCommandError } from "../../helpers/exit";
import { logError } from "../../helpers/log";
import { formatJSON } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import {
  readClaudeCodeSession,
  readCursorSession,
} from "../../helpers/session-context";
import { readCopilotSession } from "../../helpers/session-context-copilot";
import { readOpencodeSession } from "../../helpers/session-context-opencode";

const EDITORS = ["claude-code", "copilot", "cursor", "opencode"] as const;

const editorOption = new Option(
  "--editor <editor>",
  "editor whose session store holds the session"
)
  .choices(EDITORS)
  .makeOptionMandatory();

const maxEntriesOption = new Option(
  "--max-entries <n>",
  "maximum entries to return (default: 200)"
).argParser((val) => Math.trunc(Number(val)));

export function registerShowSessionContextCommand(parent: Command) {
  parent
    .command("show")
    .description("Read a specific session by ID (see `session-context list`)")
    .argument("<session-id>", "session ID from `session-context list`")
    .addOption(editorOption)
    .addOption(maxEntriesOption)
    .option(
      "--root",
      "opencode only: resolve a sub-agent child session up to its top-level ancestor"
    )
    .action(async (sessionId, opts) => {
      try {
        if (opts.root && opts.editor !== "opencode") {
          logError(
            "--root is only supported with --editor opencode (other editors have no parent/child session linkage)"
          );
          await exitWith(1);
          return;
        }

        const projectRoot = findProjectRoot();
        const readOptions = { maxEntries: opts.maxEntries, sessionId };

        const result =
          opts.editor === "opencode"
            ? readOpencodeSession(projectRoot, {
                ...readOptions,
                root: opts.root,
              })
            : opts.editor === "claude-code"
              ? await readClaudeCodeSession(projectRoot, readOptions)
              : opts.editor === "cursor"
                ? await readCursorSession(projectRoot, readOptions)
                : await readCopilotSession(projectRoot, readOptions);

        if (!result.ok) {
          logError(result.error);
          await exitWith(1);
          return;
        }

        console.log(formatJSON(result.data));
      } catch (err) {
        await handleCommandError(err);
      }
    });
}
