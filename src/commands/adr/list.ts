// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { existsSync } from "node:fs";
import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";

import { parseAllAdrs } from "../../engine/loader";
import type { AdrFrontmatter } from "../../formats/adr";
import { handleCommandError } from "../../helpers/exit";
import { formatJSON, isAgentContext } from "../../helpers/output";
import { requireProjectRoot } from "../../helpers/paths";
import { resolvedProjectPaths } from "../../helpers/project-config";

/**
 * An `adr list` entry carries identity metadata only — the same four fields the
 * table renders. `files` globs and `respectGitignore` are deliberately omitted:
 * they dominate the payload on large ADR sets (~40% of it here) without helping
 * an agent decide what to read next. Agents run `archgate adr show <id>` to get
 * the full frontmatter and body for the ADRs they actually care about.
 */
function toListEntry(fm: AdrFrontmatter) {
  return { id: fm.id, title: fm.title, domain: fm.domain, rules: fm.rules };
}

export function registerAdrListCommand(adr: Command) {
  adr
    .command("list")
    .description("List all ADRs")
    .option("--json", "Output as JSON")
    .option("--domain <domain>", "Filter by domain")
    .action(async (options) => {
      try {
        const projectRoot = requireProjectRoot();
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
              filtered.map((a) => toListEntry(a.frontmatter)),
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
        await handleCommandError(err);
      }
    });
}
