// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { exitWith, handleCommandError } from "../../helpers/exit";
import { logError } from "../../helpers/log";
import { formatJSON } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import { readOpencodeSession } from "../../helpers/session-context-opencode";

const maxEntriesOption = new Option(
  "--max-entries <n>",
  "maximum entries to return (default: 200)"
).argParser((val) => parseInt(val, 10));

const skipOption = new Option(
  "--skip <n>",
  "skip the N most recent sessions (useful when running as a sub-agent)"
)
  .argParser((val) => parseInt(val, 10))
  .default(0);

export function registerOpencodeSessionContextCommand(parent: Command) {
  parent
    .command("opencode")
    .description("Read opencode session transcript for the project")
    .addOption(maxEntriesOption)
    .addOption(skipOption)
    .option("--session-id <id>", "Specific session ID to read")
    .action(async (opts) => {
      try {
        const projectRoot = findProjectRoot();
        const result = await readOpencodeSession(projectRoot, {
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
