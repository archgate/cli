import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { buildReviewContext } from "../engine/context";
import { ADR_DOMAINS } from "../formats/adr";
import { exitWith } from "../helpers/exit";
import { logError } from "../helpers/log";
import { formatJSON } from "../helpers/output";
import { findProjectRoot } from "../helpers/paths";

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
        await exitWith(1);
        return;
      }

      try {
        const context = await buildReviewContext(projectRoot, {
          staged: opts.staged,
          runChecks: opts.runChecks,
          domain: opts.domain,
        });

        console.log(formatJSON(context));
      } catch (err) {
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });
}
