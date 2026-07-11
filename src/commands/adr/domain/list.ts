// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";

import { handleCommandError } from "../../../helpers/exit";
import { formatJSON, isAgentContext } from "../../../helpers/output";
import { requireProjectRoot } from "../../../helpers/paths";
import { listDomainEntries } from "../../../helpers/project-config";

export function registerDomainListCommand(domain: Command) {
  domain
    .command("list")
    .description("List all ADR domains (built-in and custom)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const projectRoot = requireProjectRoot();
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
        await handleCommandError(err);
      }
    });
}
