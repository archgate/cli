import type { Command } from "@commander-js/extra-typings";

import { exitWith } from "../../../helpers/exit";
import { logError } from "../../../helpers/log";
import { formatJSON, isAgentContext } from "../../../helpers/output";
import { findProjectRoot } from "../../../helpers/paths";
import {
  loadProjectConfig,
  removeCustomDomain,
} from "../../../helpers/project-config";
import { trackCustomDomainRemoved } from "../../../helpers/telemetry";

export function registerDomainRemoveCommand(domain: Command) {
  domain
    .command("remove")
    .description("Remove a custom ADR domain from the project config")
    .argument("<name>", "Domain name to remove")
    .option("--json", "Output as JSON")
    .action(async (name, options) => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        logError("No .archgate/ directory found. Run `archgate init` first.");
        await exitWith(1);
        return;
      }

      try {
        const existingPrefix = loadProjectConfig(projectRoot).domains[name];
        const { config, removed } = await removeCustomDomain(projectRoot, name);

        if (!removed) {
          const useJson = options.json || isAgentContext();
          if (useJson) {
            console.log(
              formatJSON(
                { domain: name, removed: false },
                options.json ? true : undefined
              )
            );
          } else {
            console.log(
              `Domain '${name}' is not registered as a custom domain.`
            );
          }
          return;
        }

        trackCustomDomainRemoved({
          domain_name: name,
          prefix: existingPrefix ?? "",
          total_custom_domains: Object.keys(config.domains).length,
        });

        const useJson = options.json || isAgentContext();
        if (useJson) {
          console.log(
            formatJSON(
              { domain: name, removed: true },
              options.json ? true : undefined
            )
          );
        } else {
          console.log(`Removed custom domain: ${name}`);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") throw err;
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });
}
