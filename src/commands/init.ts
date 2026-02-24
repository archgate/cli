import type { Command } from "@commander-js/extra-typings";
import { logError } from "../helpers/log";
import { initProject } from "../helpers/init-project";
import type { EditorTarget } from "../helpers/init-project";

const VALID_EDITORS = ["claude", "cursor"] as const;

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Initialize Archgate governance in the current project")
    .option(
      "--editor <editor>",
      "editor integration to configure (claude, cursor)",
      "claude"
    )
    .action(async (opts) => {
      try {
        const editor = opts.editor as string;
        if (!VALID_EDITORS.includes(editor as EditorTarget)) {
          logError(
            `Unknown editor "${editor}". Supported: ${VALID_EDITORS.join(", ")}`
          );
          process.exit(1);
        }

        const result = await initProject(process.cwd(), {
          editor: editor as EditorTarget,
        });
        console.log(`Initialized Archgate governance in ${result.projectRoot}`);
        console.log(`  adrs/          - architecture decision records`);
        console.log(`  lint/          - linter-specific rules`);
        if (editor === "cursor") {
          console.log(`  .cursor/       - Cursor settings configured`);
        } else {
          console.log(`  .claude/       - Claude Code settings configured`);
        }
      } catch (err) {
        logError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
