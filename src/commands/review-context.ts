import type { Command } from "@commander-js/extra-typings";

import { buildReviewContext } from "../engine/context";
import { exitWith } from "../helpers/exit";
import { logError } from "../helpers/log";
import { formatJSON } from "../helpers/output";
import { findProjectRoot } from "../helpers/paths";

export function registerReviewContextCommand(program: Command) {
  program
    .command("review-context")
    .description(
      "Pre-compute review context with ADR briefings for changed files"
    )
    .option("--staged", "Only include git-staged files")
    .option("--run-checks", "Include ADR compliance check results")
    .option("--domain <domain>", "Filter to a single domain")
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
