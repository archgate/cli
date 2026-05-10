// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";

import { exitWith } from "../../../helpers/exit";
import { logError } from "../../../helpers/log";
import { formatJSON, isAgentContext } from "../../../helpers/output";
import { findProjectRoot } from "../../../helpers/paths";
import { listDomainEntries } from "../../../helpers/project-config";

export function registerDomainListCommand(domain: Command) {
  domain
    .command("list")
    .description("List all ADR domains (built-in and custom)")
    .option("--json", "Output as JSON")
    .action((options) => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        logError("No .archgate/ directory found. Run `archgate init` first.");
        exitWith(1);
        return;
      }

      try {
        const entries = listDomainEntries(projectRoot);
        const useJson = options.json || isAgentContext();

        if (useJson) {
          console.log(formatJSON(entries, options.json ? true : undefined));
          return;
        }

        const nameWidth = 16;
        const prefixWidth = 10;

        console.log(
          styleText(
            "bold",
            `${"Domain".padEnd(nameWidth)}${"Prefix".padEnd(prefixWidth)}Source`
          )
        );
        console.log(
          styleText(
            "dim",
            `${"─".repeat(nameWidth)}${"─".repeat(prefixWidth)}${"─".repeat(8)}`
          )
        );
        for (const entry of entries) {
          console.log(
            `${entry.domain.padEnd(nameWidth)}${entry.prefix.padEnd(prefixWidth)}${entry.source}`
          );
        }
      } catch (err) {
        logError(err instanceof Error ? err.message : String(err));
        exitWith(1);
      }
    });
}
