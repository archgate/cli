import type { Command } from "@commander-js/extra-typings";
import { logError } from "../helpers/log";
import { initProject } from "../helpers/init-project";

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Initialize Archgate governance in the current project")
    .action(async () => {
      try {
        const result = await initProject(process.cwd());
        console.log(`Initialized Archgate governance in ${result.projectRoot}`);
        console.log(`  adrs/          - architecture decision records`);
        console.log(`  lint/          - linter-specific rules`);
        console.log(`  .claude/       - Claude Code settings configured`);
      } catch (err) {
        logError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
