import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";
import { logError } from "../helpers/log";
import { findProjectRoot } from "../helpers/paths";
import { buildReviewContext } from "../engine/context";
import { ADR_DOMAINS } from "../formats/adr";

const domainOption = new Option(
  "--domain <domain>",
  "filter to a single domain"
).choices(ADR_DOMAINS);

export function registerReviewContextCommand(program: Command) {
  program
    .command("review-context")
    .description(
      "Pre-compute review context with ADR briefings for changed files"
    )
    .option("--staged", "Only include git-staged files")
    .option("--run-checks", "Include ADR compliance check results")
    .addOption(domainOption)
    .action(async (opts) => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        logError(
          "No archgate project found. Run 'archgate init' to create one."
        );
        process.exit(1);
      }

      const context = await buildReviewContext(projectRoot, {
        staged: opts.staged,
        runChecks: opts.runChecks,
        domain: opts.domain,
      });

      console.log(JSON.stringify(context, null, 2));
    });
}
