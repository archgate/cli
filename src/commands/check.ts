import type { Command } from "@commander-js/extra-typings";

import { loadRuleAdrs } from "../engine/loader";
import {
  reportConsole,
  reportJSON,
  reportCI,
  getExitCode,
} from "../engine/reporter";
import { runChecks } from "../engine/runner";
import { logError } from "../helpers/log";
import { findProjectRoot } from "../helpers/paths";

export function registerCheckCommand(program: Command) {
  program
    .command("check")
    .description("Run ADR compliance checks")
    .option("--json", "Output results as JSON")
    .option("--ci", "Output GitHub Actions annotations")
    .option("--staged", "Only check git-staged files")
    .option("--adr <id>", "Only check rules from a specific ADR")
    .option("--verbose", "Show passing rules and timing info")
    .action(async (opts) => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        logError(
          "No archgate project found. Run 'archgate init' to create one."
        );
        process.exit(1);
      }

      const loadedAdrs = await loadRuleAdrs(projectRoot, opts.adr);

      if (loadedAdrs.length === 0) {
        if (opts.json) {
          console.log(
            JSON.stringify({
              pass: true,
              total: 0,
              passed: 0,
              failed: 0,
              warnings: 0,
              errors: 0,
              infos: 0,
              ruleErrors: 0,
              results: [],
              durationMs: 0,
            })
          );
        } else {
          console.log("  No rules to check.");
        }
        process.exit(0);
      }

      const result = await runChecks(projectRoot, loadedAdrs, {
        staged: opts.staged,
      });

      if (opts.json) {
        reportJSON(result);
      } else if (opts.ci) {
        reportCI(result);
      } else {
        reportConsole(result, opts.verbose ?? false);
      }

      process.exit(getExitCode(result));
    });
}
