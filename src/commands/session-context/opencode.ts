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
).argParser((val) => Math.trunc(Number(val)));

const skipOption = new Option(
  "--skip <n>",
  "skip the N most recent top-level sessions (sub-agent sessions are always excluded)"
)
  .argParser((val) => Math.trunc(Number(val)))
  .default(0);

export function registerOpencodeSessionContextCommand(parent: Command) {
  parent
    .command("opencode")
    .description("Read opencode session transcript for the project")
    .addOption(maxEntriesOption)
    .addOption(skipOption)
    .option("--session-id <id>", "Specific session ID to read")
    .option(
      "--root",
      "resolve to the top-level (root) session — with --session-id, walks up from a sub-agent child session"
    )
    .action(async (opts) => {
      try {
        const projectRoot = findProjectRoot();
        const result = await readOpencodeSession(projectRoot, {
          maxEntries: opts.maxEntries,
          skip: opts.skip,
          sessionId: opts.sessionId,
          root: opts.root,
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
