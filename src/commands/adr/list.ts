import { existsSync, readdirSync } from "node:fs";
import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { ADR_DOMAINS, parseAdr, type AdrDocument } from "../../formats/adr";
import { logError } from "../../helpers/log";
import { findProjectRoot, projectPaths } from "../../helpers/paths";

async function loadAdrs(adrsDir: string): Promise<AdrDocument[]> {
  const files = readdirSync(adrsDir).filter((f) => f.endsWith(".md"));
  const results = await Promise.all(
    files.map(async (file) => {
      try {
        const content = await Bun.file(`${adrsDir}/${file}`).text();
        return parseAdr(content, file);
      } catch {
        return null;
      }
    })
  );
  return results.filter((r): r is AdrDocument => r !== null);
}

export function registerAdrListCommand(adr: Command) {
  adr
    .command("list")
    .description("List all ADRs")
    .option("--json", "Output as JSON")
    .addOption(
      new Option("--domain <domain>", "Filter by domain").choices(ADR_DOMAINS)
    )
    .action(async (options) => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        logError("No .archgate/ directory found. Run `archgate init` first.");
        process.exit(1);
      }

      try {
        const paths = projectPaths(projectRoot);

        if (!existsSync(paths.adrsDir)) {
          console.log("No ADRs found.");
          return;
        }

        const files = readdirSync(paths.adrsDir).filter((f) =>
          f.endsWith(".md")
        );

        if (files.length === 0) {
          console.log("No ADRs found.");
          return;
        }

        const adrs = await loadAdrs(paths.adrsDir);

        // Filter by domain if specified
        const filtered = options.domain
          ? adrs.filter((a) => a.frontmatter.domain === options.domain)
          : adrs;

        if (options.json) {
          console.log(
            JSON.stringify(
              filtered.map((a) => a.frontmatter),
              null,
              2
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
        logError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
