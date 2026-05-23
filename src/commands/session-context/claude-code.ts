// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { exitWith } from "../../helpers/exit";
import { logError } from "../../helpers/log";
import { formatJSON } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import { readClaudeCodeSession } from "../../helpers/session-context";

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

export function registerClaudeCodeSessionContextCommand(parent: Command) {
  parent
    .command("claude-code")
    .description("Read Claude Code session transcript for the project")
    .addOption(maxEntriesOption)
    .addOption(skipOption)
    .action(async (opts) => {
      try {
        const projectRoot = findProjectRoot();
        const result = await readClaudeCodeSession(projectRoot, {
          maxEntries: opts.maxEntries,
          skip: opts.skip,
        });

        if (!result.ok) {
          logError(result.error);
          await exitWith(1);
          return;
        }

        console.log(formatJSON(result.data));
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") throw err;
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });
}
