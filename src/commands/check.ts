// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { resolveBaseRef } from "../engine/git-files";
import { loadRuleAdrs } from "../engine/loader";
import {
  reportConsole,
  reportJSON,
  reportCI,
  getExitCode,
  buildSummary,
} from "../engine/reporter";
import { runChecks } from "../engine/runner";
import { exitWith, handleCommandError } from "../helpers/exit";
import { formatJSON, isAgentContext } from "../helpers/output";
import { findProjectRoot } from "../helpers/paths";
import { getConfiguredBaseBranch } from "../helpers/project-config";
import { detectStack } from "../helpers/stack-detect";
import { trackCheckResult } from "../helpers/telemetry";
import { UserError } from "../helpers/user-error";

const maxWarningsOption = new Option(
  "--max-warnings <n>",
  "Fail (exit 1) when the number of warnings exceeds this threshold (0 = fail on any warning)"
).argParser((val) => Math.trunc(Number(val)));

export function registerCheckCommand(program: Command) {
  program
    .command("check")
    .description("Run ADR compliance checks")
    .option("--json", "Output results as JSON")
    .option("--ci", "Output GitHub Actions annotations")
    .option("--staged", "Only check git-staged files")
    .option(
      "--base [ref]",
      "Compare changed files against a base ref (auto-detects when omitted)"
    )
    .option("--adr <id>", "Only check rules from a specific ADR")
    .option("--verbose", "Show passing rules and timing info")
    .addOption(maxWarningsOption)
    .argument("[files...]", "Only check rules relevant to these files")
    .action(async (files, opts) => {
      // ARCH-012: full error boundary — any error escaping this body would
      // otherwise land in main().catch() and be miscategorized as an
      // internal crash (exit 2 + Sentry) instead of a user error (exit 1).
      try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) {
          throw new UserError(
            "No archgate project found. Run 'archgate init' to create one."
          );
        }

        const maxWarnings = opts.maxWarnings;
        if (
          maxWarnings !== undefined &&
          (Number.isNaN(maxWarnings) || maxWarnings < 0)
        ) {
          throw new UserError("--max-warnings must be a non-negative integer");
        }

        // Run stack detection in parallel with rule loading — both are fast I/O
        // and independent. Stack info enriches the telemetry event at the end.
        // Bounded with a timeout so pathological projects can't stall the exit.
        const stackPromise = Promise.race([
          detectStack(projectRoot),
          Bun.sleep(500).then(() => null),
        ]).catch(() => null);

        const loadStart = performance.now();
        const loadResults = await loadRuleAdrs(projectRoot, opts.adr);
        const loadDurationMs = Math.round(performance.now() - loadStart);

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
                  warningsExceeded: false,
                  results: [],
                  durationMs: 0,
                },
                opts.json ? true : undefined
              )
            );
          } else {
            console.log("  No rules to check.");
          }
          await exitWith(0);
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
            const piped = stdin.trim().split(/\r?\n/u).filter(Boolean);
            for (const f of piped) filterFiles.push(f);
          } catch {
            // stdin not readable — ignore
          }
        }

        // Resolve base ref for branch-level change detection.
        // Priority: --staged (skips base) → --base <ref> → config → auto-detect
        const resolvedBase = await resolveBaseRef(projectRoot, {
          staged: opts.staged,
          base: opts.base,
          configBase: getConfiguredBaseBranch(projectRoot),
        });

        const result = await runChecks(projectRoot, loadResults, {
          staged: opts.staged,
          base: resolvedBase,
          files: filterFiles.length > 0 ? filterFiles : undefined,
        });

        // Determine output format for telemetry
        const outputFormat = opts.ci ? "ci" : useJson ? "json" : "console";

        // Build the summary once and share it with the reporters, telemetry,
        // and exit-code resolver. Previously each of those built its own
        // summary — 3 walks over the same result set.
        const summary = buildSummary(result, { maxWarnings });

        if (opts.ci) {
          reportCI(result, summary);
        } else if (useJson) {
          reportJSON(result, opts.json ? true : undefined, summary);
        } else {
          reportConsole(result, opts.verbose ?? false, summary);
        }

        // Await stack detection (started in parallel with rule loading above).
        const stack = await stackPromise;

        // Track aggregate check results (no file paths or violation content)
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
          used_base: Boolean(resolvedBase),
          used_file_filter: filterFiles.length > 0,
          used_adr_filter: Boolean(opts.adr),
          used_max_warnings: maxWarnings !== undefined,
          files_scanned: filterFiles.length,
          load_duration_ms: loadDurationMs,
          check_duration_ms: Math.round(result.totalDurationMs),
          languages: stack?.languages,
          runtimes: stack?.runtimes,
          frameworks: stack?.frameworks,
        });

        const exitCode = getExitCode(result, summary);
        // Only 0, 1, and 2 are emitted by getExitCode()
        await exitWith(exitCode);
      } catch (err) {
        // handleCommandError re-throws ExitPromptError so main().catch()
        // handles Ctrl+C (exit 130); UserError exits 1, bugs exit 2 + Sentry.
        await handleCommandError(err);
      }
    });
}
