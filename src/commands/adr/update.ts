import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";
import { existsSync } from "node:fs";
import { projectPaths } from "../../helpers/paths";
import { ADR_DOMAINS } from "../../formats/adr";
import { updateAdrFile } from "../../helpers/adr-writer";
import { logError } from "../../helpers/log";

const domainOption = new Option("--domain <domain>", "new ADR domain").choices(
  ADR_DOMAINS
);

export function registerAdrUpdateCommand(adr: Command) {
  adr
    .command("update")
    .description("Update an existing ADR by ID")
    .requiredOption("--id <id>", "ADR ID to update (e.g., ARCH-001)")
    .requiredOption("--body <markdown>", "Full replacement ADR body markdown")
    .option("--title <title>", "New ADR title (preserves existing if omitted)")
    .addOption(domainOption)
    .option(
      "--files <patterns>",
      "New file patterns, comma-separated (preserves existing if omitted)"
    )
    .option("--rules", "Set rules: true in frontmatter")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const projectRoot = process.cwd();
      const paths = projectPaths(projectRoot);

      if (!existsSync(paths.root)) {
        logError("No .archgate/ directory found. Run `archgate init` first.");
        process.exit(1);
      }

      const files = opts.files
        ? opts.files
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean)
        : undefined;

      try {
        const result = await updateAdrFile(paths.adrsDir, {
          id: opts.id,
          body: opts.body,
          title: opts.title,
          domain: opts.domain,
          files,
          rules: opts.rules,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Updated ADR: ${result.filePath}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError(message);
        process.exit(1);
      }
    });
}
