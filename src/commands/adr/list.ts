// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { existsSync } from "node:fs";
import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";

import { parseAllAdrs } from "../../engine/loader";
import { exitWith } from "../../helpers/exit";
import { logError } from "../../helpers/log";
import { formatJSON, isAgentContext } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import { resolvedProjectPaths } from "../../helpers/project-config";

export function registerAdrListCommand(adr: Command) {
  adr
    .command("list")
    .description("List all ADRs")
    .option("--json", "Output as JSON")
    .option("--domain <domain>", "Filter by domain")
    .action(async (options) => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        logError("No .archgate/ directory found. Run `archgate init` first.");
        await exitWith(1);
        return;
      }

      try {
        const paths = resolvedProjectPaths(projectRoot);

        if (!existsSync(paths.adrsDir)) {
          console.log("No ADRs found.");
          return;
        }

        // parseAllAdrs is cached per-process and shared with the check /
        // review-context engines, so we don't need a separate readdir pass
        // to bail early on empty dirs.
        const adrs = (await parseAllAdrs(projectRoot)).map((e) => e.adr);

        if (adrs.length === 0) {
          console.log("No ADRs found.");
          return;
        }

        // Filter by domain if specified
        const filtered = options.domain
          ? adrs.filter((a) => a.frontmatter.domain === options.domain)
          : adrs;

        const useJson = options.json || isAgentContext();
        if (useJson) {
          console.log(
            formatJSON(
              filtered.map((a) => a.frontmatter),
              options.json ? true : undefined
            )
          );
          return;
        }

        // Table output
        const idWidth = 12;
        const domainWidth = 14;
        const rulesWidth = 7;

        console.log(
          styleText(
            "bold",
            `${"ID".padEnd(idWidth)}${"Domain".padEnd(domainWidth)}${"Rules".padEnd(rulesWidth)}Title`
          )
        );
        console.log(
          styleText(
            "dim",
            `${"─".repeat(idWidth)}${"─".repeat(domainWidth)}${"─".repeat(rulesWidth)}${"─".repeat(30)}`
          )
        );

        for (const adr of filtered) {
          const fm = adr.frontmatter;
          console.log(
            `${fm.id.padEnd(idWidth)}${fm.domain.padEnd(domainWidth)}${String(fm.rules).padEnd(rulesWidth)}${fm.title}`
          );
        }
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") throw err;
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });
}
