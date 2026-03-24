import type { Command } from "@commander-js/extra-typings";

import { loadRuleAdrs } from "../engine/loader";
import {
  reportConsole,
  reportJSON,
  reportCI,
  getExitCode,
  buildSummary,
} from "../engine/reporter";
import { runChecks } from "../engine/runner";
import { logError } from "../helpers/log";
import { formatJSON, isAgentContext } from "../helpers/output";
import { findProjectRoot } from "../helpers/paths";
import { trackCheckResult } from "../helpers/telemetry";

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

      let loadResults;
      try {
        loadResults = await loadRuleAdrs(projectRoot, opts.adr);
      } catch (err) {
        logError(
          err instanceof Error ? err.message : `Failed to load rules: ${err}`
        );
        process.exit(1);
      }

      const useJson = opts.json || (!opts.ci && isAgentContext());

      if (loadResults.length === 0) {
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

      // Collect file paths from arguments and/or stdin pipe.
      // Only read stdin when it's explicitly piped (e.g., `git diff --name-only | archgate check`).
      // When spawned by editors or in a pipe chain where stdin is /dev/null or absent,
      // attempting to read stdin blocks forever. Use a short timeout to detect this.
      let filterFiles: string[] = files ?? [];
      if (!process.stdin.isTTY) {
        try {
          const stdin = await Promise.race([
            Bun.stdin.text(),
            Bun.sleep(100).then(() => ""),
          ]);
          const piped = stdin.trim().split(/\r?\n/).filter(Boolean);
          filterFiles = [...filterFiles, ...piped];
        } catch {
          // stdin not readable — ignore
        }
      }

      const result = await runChecks(projectRoot, loadResults, {
        staged: opts.staged,
        files: filterFiles.length > 0 ? filterFiles : undefined,
      });

      // Determine output format for telemetry
      const outputFormat = opts.ci ? "ci" : useJson ? "json" : "console";

      if (opts.ci) {
        reportCI(result);
      } else if (useJson) {
        reportJSON(result, opts.json ? true : undefined);
      } else {
        reportConsole(result, opts.verbose ?? false);
      }

      // Track aggregate check results (no file paths or violation content)
      const summary = buildSummary(result);
      trackCheckResult({
        total_rules: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        warnings: summary.warnings,
        errors: summary.errors,
        rule_errors: summary.ruleErrors,
        pass: summary.pass,
        output_format: outputFormat,
        used_staged: Boolean(opts.staged),
        used_file_filter: filterFiles.length > 0,
        used_adr_filter: Boolean(opts.adr),
      });

      process.exit(getExitCode(result));
    });
}
