import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { exitWith } from "../../helpers/exit";
import { logError } from "../../helpers/log";
import { formatJSON } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import { readCopilotSession } from "../../helpers/session-context-copilot";

const maxEntriesOption = new Option(
  "--max-entries <n>",
  "maximum entries to return (default: 200)"
).argParser((val) => parseInt(val, 10));

export function registerCopilotSessionContextCommand(parent: Command) {
  parent
    .command("copilot")
    .description("Read Copilot CLI session transcript for the project")
    .addOption(maxEntriesOption)
    .option("--session-id <id>", "Specific session UUID to read")
    .action(async (opts) => {
      try {
        const projectRoot = findProjectRoot();
        const result = await readCopilotSession(projectRoot, {
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
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });
}
