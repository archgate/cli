import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { Command } from "@commander-js/extra-typings";

import { exitWith } from "../helpers/exit";
import { logError } from "../helpers/log";
import { internalPath } from "../helpers/paths";

/**
 * Check whether the running binary lives under ~/.archgate/bin/.
 * When true, the bin/ directory must be preserved during clean.
 */
function shouldPreserveBinDir(): boolean {
  const binDir = internalPath("bin");
  return process.execPath.startsWith(binDir);
}

export function registerCleanCommand(program: Command) {
  program
    .command("clean")
    .description("Clean the CLI temp files")
    .action(async () => {
      const destinationPath = internalPath();

      if (!existsSync(destinationPath)) {
        console.log("Nothing to clean.");
        return;
      }

      const preserveBin = shouldPreserveBinDir();

      try {
        if (preserveBin) {
          // Remove everything except bin/ to avoid deleting the running binary
          for (const entry of readdirSync(destinationPath)) {
            if (entry === "bin") continue;
            rmSync(join(destinationPath, entry), {
              recursive: true,
              force: true,
            });
          }
          console.log(`${destinationPath} cleaned up (bin/ preserved)`);
        } else {
          rmSync(destinationPath, { recursive: true, force: true });
          console.log(`${destinationPath} cleaned up`);
        }
      } catch (error) {
        logError(
          `Failed to clean ${destinationPath}.`,
          error instanceof Error ? error.message : String(error)
        );
        await exitWith(1);
      }
    });
}
