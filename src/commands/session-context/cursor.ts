import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";
import { findProjectRoot } from "../../helpers/paths";
import { readCursorSession } from "../../helpers/session-context";
import { logError } from "../../helpers/log";

const maxEntriesOption = new Option(
  "--max-entries <n>",
  "maximum entries to return (default: 200)"
).argParser((val) => parseInt(val, 10));

export function registerCursorSessionContextCommand(parent: Command) {
  parent
    .command("cursor")
    .description("Read Cursor agent session transcript for the project")
    .addOption(maxEntriesOption)
    .option("--session-id <id>", "Specific session UUID to read")
    .action(async (opts) => {
      const projectRoot = findProjectRoot();
      const result = await readCursorSession(projectRoot, {
        maxEntries: opts.maxEntries,
        sessionId: opts.sessionId,
      });

      if (!result.ok) {
        logError(result.error);
        process.exit(1);
      }

      console.log(JSON.stringify(result.data, null, 2));
    });
}
