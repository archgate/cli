import type { Command } from "@commander-js/extra-typings";

import { exitWith } from "../../../helpers/exit";
import { logError } from "../../../helpers/log";
import { formatJSON, isAgentContext } from "../../../helpers/output";
import { findProjectRoot } from "../../../helpers/paths";
import { addCustomDomain } from "../../../helpers/project-config";
import { trackCustomDomainAdded } from "../../../helpers/telemetry";

export function registerDomainAddCommand(domain: Command) {
  domain
    .command("add")
    .description("Register a custom ADR domain with an ID prefix")
    .argument("<name>", "Domain name (lowercase kebab-case, e.g. 'security')")
    .argument("<prefix>", "ID prefix (uppercase, e.g. 'SEC')")
    .option("--json", "Output as JSON")
    .action(async (name, prefix, options) => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        logError("No .archgate/ directory found. Run `archgate init` first.");
        await exitWith(1);
        return;
      }

      try {
        const config = await addCustomDomain(projectRoot, name, prefix);
        const totalCustom = Object.keys(config.domains).length;
        trackCustomDomainAdded({
          domain_name: name,
          prefix,
          total_custom_domains: totalCustom,
        });

        const useJson = options.json || isAgentContext();
        if (useJson) {
          console.log(
            formatJSON(
              { domain: name, prefix, added: true },
              options.json ? true : undefined
            )
          );
        } else {
          console.log(`Registered custom domain: ${name} → ${prefix}`);
        }
      } catch (err) {
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });
}
