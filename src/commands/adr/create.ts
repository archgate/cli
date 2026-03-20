import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";
import inquirer from "inquirer";

import { ADR_DOMAINS, type AdrDomain } from "../../formats/adr";
import { createAdrFile } from "../../helpers/adr-writer";
import { logError } from "../../helpers/log";
import { findProjectRoot, projectPaths } from "../../helpers/paths";

const domainOption = new Option("--domain <domain>", "ADR domain").choices(
  ADR_DOMAINS
);

export function registerAdrCreateCommand(adr: Command) {
  adr
    .command("create")
    .description("Create a new ADR")
    .option("--title <title>", "ADR title (skip interactive prompt)")
    .addOption(domainOption)
    .option("--files <patterns>", "File patterns, comma-separated")
    .option("--body <markdown>", "Full ADR body markdown (skip template)")
    .option("--rules", "Set rules: true in frontmatter")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        logError("No .archgate/ directory found. Run `archgate init` first.");
        process.exit(1);
      }

      try {
        const paths = projectPaths(projectRoot);

        let domain: AdrDomain;
        let title: string;
        let files: string[] | undefined;
        let body: string | undefined;

        // Non-interactive mode when --title and --domain are provided
        if (opts.title && opts.domain) {
          domain = opts.domain;
          title = opts.title;
          files = opts.files
            ? opts.files
                .split(",")
                .map((f) => f.trim())
                .filter(Boolean)
            : undefined;
          body = opts.body;
        } else {
          // Interactive mode
          const answers = await inquirer.prompt([
            {
              type: "list",
              name: "domain",
              message: "Domain:",
              choices: ADR_DOMAINS.map((d) => ({ name: d, value: d })),
            },
            {
              type: "input",
              name: "title",
              message: "Title:",
              validate: (input: string) =>
                input.trim() !== "" || "Title is required",
            },
            {
              type: "input",
              name: "files",
              message: "File patterns (comma-separated, optional):",
            },
          ]);

          domain = answers.domain as AdrDomain;
          title = answers.title;
          files = answers.files
            ? answers.files
                .split(",")
                .map((f: string) => f.trim())
                .filter(Boolean)
            : undefined;
        }

        const result = await createAdrFile(paths.adrsDir, {
          title,
          domain,
          files,
          body,
          rules: opts.rules,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Created ADR: ${result.filePath}`);
        }
      } catch (err) {
        logError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
