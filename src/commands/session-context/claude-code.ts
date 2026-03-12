import type { Command } from "@commander-js/extra-typings";
import { findProjectRoot } from "../../helpers/paths";
import { readClaudeCodeSession } from "../../helpers/session-context";
import { logError } from "../../helpers/log";

export function registerClaudeCodeSessionContextCommand(parent: Command) {
  parent
    .command("claude-code")
    .description("Read Claude Code session transcript for the project")
    .option(
      "--max-entries <n>",
      "Maximum entries to return (default: 200)",
      parseInt
    )
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
