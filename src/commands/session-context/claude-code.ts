import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { logError } from "../../helpers/log";
import { formatJSON } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import { readClaudeCodeSession } from "../../helpers/session-context";

const maxEntriesOption = new Option(
  "--max-entries <n>",
  "maximum entries to return (default: 200)"
).argParser((val) => parseInt(val, 10));

export function registerClaudeCodeSessionContextCommand(parent: Command) {
  parent
    .command("claude-code")
    .description("Read Claude Code session transcript for the project")
    .addOption(maxEntriesOption)
    .action(async (opts) => {
      try {
        const projectRoot = findProjectRoot();
        const result = await readClaudeCodeSession(projectRoot, {
          maxEntries: opts.maxEntries,
        });

        if (!result.ok) {
          logError(result.error);
          process.exit(1);
        }

        console.log(formatJSON(result.data));
      } catch (err) {
        logError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
