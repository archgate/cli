import type { Command } from "@commander-js/extra-typings";
import { existsSync } from "node:fs";
import { rmSync } from "node:fs";
import { internalPath } from "../helpers/paths";
import { logError } from "../helpers/log";

export function registerCleanCommand(program: Command) {
  program
    .command("clean")
    .description("Clean the CLI temp files")
    .action(() => {
      const destinationPath = internalPath();

      if (!existsSync(destinationPath)) {
        console.log("Nothing to clean.");
        return;
      }

      try {
        rmSync(destinationPath, { recursive: true, force: true });
        console.log(`${destinationPath} cleaned up`);
      } catch (error) {
        logError(
          `Failed to clean ${destinationPath}.`,
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
