import type { Command } from "@commander-js/extra-typings";
import { logError } from "../helpers/log";
import { findProjectRoot } from "../helpers/paths";
import { buildReviewContext } from "../engine/context";
import { AdrFrontmatterSchema } from "../formats/adr";

export function registerReviewContextCommand(program: Command) {
  program
    .command("review-context")
    .description(
      "Pre-compute review context with ADR briefings for changed files"
    )
    .option("--staged", "Only include git-staged files")
    .option("--run-checks", "Include ADR compliance check results")
    .option(
      "--domain <domain>",
      "Filter to a single domain (backend, frontend, data, architecture, general)"
    )
    .action(async (opts) => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        logError(
          "No archgate project found. Run 'archgate init' to create one."
        );
        process.exit(1);
      }

      if (opts.domain) {
        const result = AdrFrontmatterSchema.shape.domain.safeParse(opts.domain);
        if (!result.success) {
          logError(
            `Invalid domain '${opts.domain}'. Use: backend, frontend, data, architecture, general`
          );
          process.exit(1);
        }
      }

      const context = await buildReviewContext(projectRoot, {
        staged: opts.staged,
        runChecks: opts.runChecks,
        domain: opts.domain as
          | "backend"
          | "frontend"
          | "data"
          | "architecture"
          | "general"
          | undefined,
      });

      console.log(JSON.stringify(context, null, 2));
    });
}
