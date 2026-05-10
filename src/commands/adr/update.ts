// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";

import { updateAdrFile } from "../../helpers/adr-writer";
import { exitWith } from "../../helpers/exit";
import { logError } from "../../helpers/log";
import { formatJSON, isAgentContext } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import {
  resolveDomainPrefix,
  resolvedProjectPaths,
} from "../../helpers/project-config";

export function registerAdrUpdateCommand(adr: Command) {
  adr
    .command("update")
    .description("Update an existing ADR by ID")
    .requiredOption("--id <id>", "ADR ID to update (e.g., ARCH-001)")
    .requiredOption("--body <markdown>", "Full replacement ADR body markdown")
    .option("--title <title>", "New ADR title (preserves existing if omitted)")
    .option(
      "--domain <domain>",
      "New ADR domain (built-in or registered via `archgate domain add`)"
    )
    .option(
      "--files <patterns>",
      "New file patterns, comma-separated (preserves existing if omitted)"
    )
    .option("--rules", "Set rules: true in frontmatter")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        logError("No .archgate/ directory found. Run `archgate init` first.");
        await exitWith(1);
        return;
      }
      const paths = resolvedProjectPaths(projectRoot);

      const files = opts.files
        ? opts.files
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean)
        : undefined;

      try {
        if (opts.domain) {
          // Validate the domain against the merged config now so users get
          // a clear error instead of a stale prefix mismatch later.
          resolveDomainPrefix(projectRoot, opts.domain);
        }

        const result = await updateAdrFile(paths.adrsDir, {
          id: opts.id,
          body: opts.body,
          title: opts.title,
          domain: opts.domain,
          files,
          rules: opts.rules,
        });

        const useJson = opts.json || isAgentContext();
        if (useJson) {
          console.log(formatJSON(result, opts.json ? true : undefined));
        } else {
          console.log(`Updated ADR: ${result.filePath}`);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") throw err;
        const message = err instanceof Error ? err.message : String(err);
        logError(message);
        await exitWith(1);
      }
    });
}
