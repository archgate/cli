// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { exitWith, handleCommandError } from "../../helpers/exit";
import { logError } from "../../helpers/log";
import { formatJSON } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import { readCursorSession } from "../../helpers/session-context";

const maxEntriesOption = new Option(
  "--max-entries <n>",
  "maximum entries to return (default: 200)"
).argParser((val) => Math.trunc(Number(val)));

const skipOption = new Option(
  "--skip <n>",
  "skip the N most recent sessions to read an earlier conversation"
)
  .argParser((val) => Math.trunc(Number(val)))
  .default(0);

export function registerCursorSessionContextCommand(parent: Command) {
  parent
    .command("cursor")
    .description("Read Cursor agent session transcript for the project")
    .addOption(maxEntriesOption)
    .addOption(skipOption)
    .option("--session-id <id>", "Specific session UUID to read")
    .action(async (opts) => {
      try {
        const projectRoot = findProjectRoot();
        const result = await readCursorSession(projectRoot, {
          maxEntries: opts.maxEntries,
          skip: opts.skip,
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
