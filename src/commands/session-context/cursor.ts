// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { exitWith, handleCommandError } from "../../helpers/exit";
import { logError } from "../../helpers/log";
import { formatJSON } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import {
  listCursorSessions,
  readCursorSession,
} from "../../helpers/session-context";

const maxEntriesOption = new Option(
  "--max-entries <n>",
  "maximum entries to return (default: 200)"
).argParser((val) => Math.trunc(Number(val)));

const listOption = new Option(
  "--list",
  "list available sessions for the project instead of reading one"
).conflicts("sessionId");

export function registerCursorSessionContextCommand(parent: Command) {
  parent
    .command("cursor")
    .description("Read Cursor agent session transcript for the project")
    .addOption(maxEntriesOption)
    .option("--session-id <id>", "Specific session UUID to read")
    .addOption(listOption)
    .action(async (opts) => {
      try {
        const projectRoot = findProjectRoot();

        if (opts.list) {
          const listed = await listCursorSessions(projectRoot);
          if (!listed.ok) {
            logError(listed.error);
            await exitWith(1);
            return;
          }
          console.log(formatJSON(listed.data));
          return;
        }

        const result = await readCursorSession(projectRoot, {
          maxEntries: opts.maxEntries,
          sessionId: opts.sessionId,
        });

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
