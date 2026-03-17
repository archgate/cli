import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { logError } from "../../helpers/log";
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
      const projectRoot = findProjectRoot();
      const result = await readClaudeCodeSession(projectRoot, {
        maxEntries: opts.maxEntries,
      });

      if (!result.ok) {
        logError(result.error);
        process.exit(1);
      }

      console.log(JSON.stringify(result.data, null, 2));
    });
}
