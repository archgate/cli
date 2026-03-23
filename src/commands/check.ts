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
import { formatJSON, isAgentContext } from "../helpers/output";
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
    .argument("[files...]", "Only check rules relevant to these files")
    .action(async (files, opts) => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        logError(
          "No archgate project found. Run 'archgate init' to create one."
        );
        process.exit(1);
      }

      let loadedAdrs;
      try {
        loadedAdrs = await loadRuleAdrs(projectRoot, opts.adr);
      } catch (err) {
        logError(
          err instanceof Error ? err.message : `Failed to load rules: ${err}`
        );
        process.exit(1);
      }

      const useJson = opts.json || (!opts.ci && isAgentContext());

      if (loadedAdrs.length === 0) {
        if (useJson) {
          console.log(
            formatJSON(
              {
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
              },
              opts.json ? true : undefined
            )
          );
        } else {
          console.log("  No rules to check.");
        }
        process.exit(0);
      }

      // Collect file paths from arguments and/or stdin pipe
      let filterFiles: string[] = files ?? [];
      if (!process.stdin.isTTY) {
        const stdin = await new Response(
          process.stdin as unknown as ReadableStream
        ).text();
        const piped = stdin.trim().split(/\r?\n/).filter(Boolean);
        filterFiles = [...filterFiles, ...piped];
      }

      const result = await runChecks(projectRoot, loadedAdrs, {
        staged: opts.staged,
        files: filterFiles.length > 0 ? filterFiles : undefined,
      });

      if (opts.ci) {
        reportCI(result);
      } else if (useJson) {
        reportJSON(result, opts.json ? true : undefined);
      } else {
        reportConsole(result, opts.verbose ?? false);
      }

      process.exit(getExitCode(result));
    });
}
