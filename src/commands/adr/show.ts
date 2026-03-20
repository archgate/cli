import type { Command } from "@commander-js/extra-typings";

import { findAdrFileById } from "../../helpers/adr-writer";
import { logError } from "../../helpers/log";
import { findProjectRoot, projectPaths } from "../../helpers/paths";

export function registerAdrShowCommand(adr: Command) {
  adr
    .command("show")
    .description("Show a specific ADR by ID")
    .argument("<id>", "ADR ID (e.g., GEN-001)")
    .action(async (id) => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        logError("No .archgate/ directory found. Run `archgate init` first.");
        process.exit(1);
      }

      try {
        const { adrsDir } = projectPaths(projectRoot);
        const adr = await findAdrFileById(adrsDir, id);

        if (!adr) {
          logError(`ADR with ID '${id}' not found.`);
          process.exit(1);
        }

        const content = await Bun.file(adr.filePath).text();
        console.log(content);
      } catch (err) {
        logError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
