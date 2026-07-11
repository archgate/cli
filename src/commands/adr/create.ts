// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";

import type { AdrDomain } from "../../formats/adr";
import { createAdrFile } from "../../helpers/adr-writer";
import { handleCommandError } from "../../helpers/exit";
import { formatJSON, isAgentContext } from "../../helpers/output";
import { requireProjectRoot } from "../../helpers/paths";
import {
  getAllDomainNames,
  resolveDomainPrefix,
  resolvedProjectPaths,
} from "../../helpers/project-config";
import { withPromptFix } from "../../helpers/prompt";

export function registerAdrCreateCommand(adr: Command) {
  adr
    .command("create")
    .description("Create a new ADR")
    .option("--title <title>", "ADR title (skip interactive prompt)")
    .option(
      "--domain <domain>",
      "ADR domain (built-in or registered via `archgate domain add`)"
    )
    .option("--files <patterns>", "File patterns, comma-separated")
    .option("--body <markdown>", "Full ADR body markdown (skip template)")
    .option("--rules", "Set rules: true in frontmatter")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const projectRoot = requireProjectRoot();
        const paths = resolvedProjectPaths(projectRoot);

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
          const choices = getAllDomainNames(projectRoot);
          // Lazy-load inquirer — it costs ~200ms to parse and is only
          // needed for interactive prompts, not for scripted --title/--domain
          // invocations or --help/--version.
          const { default: inquirer } = await import("inquirer");
          // Interactive mode
          const answers = await withPromptFix(() =>
            inquirer.prompt([
              {
                type: "select",
                name: "domain",
                message: "Domain:",
                choices: choices.map((d) => ({ name: d, value: d })),
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
            ])
          );

          domain = answers.domain;
          title = answers.title;
          files = answers.files
            ? answers.files
                .split(",")
                .map((f: string) => f.trim())
                .filter(Boolean)
            : undefined;
        }

        const prefix = resolveDomainPrefix(projectRoot, domain);

        const result = await createAdrFile(paths.adrsDir, {
          title,
          domain,
          prefix,
          files,
          body,
          rules: opts.rules,
        });

        const useJson = opts.json || isAgentContext();
        if (useJson) {
          console.log(formatJSON(result, opts.json ? true : undefined));
        } else {
          console.log(`Created ADR: ${result.filePath}`);
        }
      } catch (err) {
        await handleCommandError(err);
      }
    });
}
