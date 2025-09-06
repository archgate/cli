import type { Command } from "@commander-js/extra-typings";
import { existsSync } from "node:fs";
import inquirer from "inquirer";
import { projectPaths } from "../../helpers/paths";
import {
  ADR_DOMAINS,
  AdrFrontmatterSchema,
  type AdrDomain,
} from "../../formats/adr";
import { createAdrFile } from "../../helpers/adr-writer";
import { logError } from "../../helpers/log";

export function registerAdrCreateCommand(adr: Command) {
  adr
    .command("create")
    .description("Create a new ADR")
    .option("--title <title>", "ADR title (skip interactive prompt)")
    .option(
      "--domain <domain>",
      "ADR domain: backend, frontend, data, architecture, general"
    )
    .option("--files <patterns>", "File patterns, comma-separated")
    .option("--body <markdown>", "Full ADR body markdown (skip template)")
    .option("--rules", "Set rules: true in frontmatter")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const projectRoot = process.cwd();
      const paths = projectPaths(projectRoot);

      if (!existsSync(paths.root)) {
        logError("No .archgate/ directory found. Run `archgate init` first.");
        process.exit(1);
      }

      let domain: AdrDomain;
      let title: string;
      let files: string[] | undefined;
      let body: string | undefined;

      // Non-interactive mode when --title and --domain are provided
      if (opts.title && opts.domain) {
        const domainResult = AdrFrontmatterSchema.shape.domain.safeParse(
          opts.domain
        );
        if (!domainResult.success) {
          logError(
            `Invalid domain '${opts.domain}'. Must be one of: ${ADR_DOMAINS.join(", ")}`
          );
          process.exit(1);
        }
        domain = domainResult.data;
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
    });
}
