// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";

import { findAdrFileById } from "../../helpers/adr-writer";
import { handleCommandError } from "../../helpers/exit";
import { requireProjectRoot } from "../../helpers/paths";
import { resolvedProjectPaths } from "../../helpers/project-config";
import { UserError } from "../../helpers/user-error";

export function registerAdrShowCommand(adr: Command) {
  adr
    .command("show")
    .description("Show a specific ADR by ID")
    .argument("<id>", "ADR ID (e.g., GEN-001)")
    .action(async (id) => {
      try {
        const projectRoot = requireProjectRoot();
        const { adrsDir } = resolvedProjectPaths(projectRoot);
        const adr = await findAdrFileById(adrsDir, id);

        if (!adr) {
          throw new UserError(`ADR with ID '${id}' not found.`);
        }

        const content = await Bun.file(adr.filePath).text();
        console.log(content);
      } catch (err) {
        await handleCommandError(err);
      }
    });
}
