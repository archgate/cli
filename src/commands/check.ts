// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { collectBriefingDiagnostics } from "../engine/adr-sections";
import { resolveBaseRef } from "../engine/git-files";
import { loadRuleAdrs } from "../engine/loader";
import {
  reportConsole,
  reportJSON,
  reportCI,
  reportSarif,
  getExitCode,
  buildSummary,
} from "../engine/reporter";
import { runChecks } from "../engine/runner";
import type { CheckResult } from "../engine/runner";
import { exitWith, handleCommandError } from "../helpers/exit";
import { logWarn } from "../helpers/log";
import { isAgentContext } from "../helpers/output";
import { requireProjectRoot } from "../helpers/paths";
import {
  getConfiguredBaseBranch,
  getConfiguredStrict,
} from "../helpers/project-config";
import { detectStack } from "../helpers/stack-detect";
import { trackCheckResult } from "../helpers/telemetry";

const outputOption = new Option(
  "--output <format>",
  "Output format: console (default), json, github, or sarif"
).choices(["console", "json", "github", "sarif"] as const);

export function registerCheckCommand(program: Command) {
  program
    .command("check")
    .description("Run ADR compliance checks")
    .option("--staged", "Only check git-staged files")
    .option(
      "--base [ref]",
      "Compare changed files against a base ref (auto-detects when omitted)"
    )
    .option("--adr <id>", "Only check rules from a specific ADR")
    .option("--verbose", "Show passing rules and timing info")
    .option(
      "--strict",
      "Treat any rule-severity warning, and advisory findings (briefing-budget, suppression, unparsed-ADR warnings), as failures"
    )
    .addOption(outputOption)
    .argument("[files...]", "Only check rules relevant to these files")
    .action(async (files, opts) => {
      // ARCH-012: full error boundary — any error escaping this body would
      // otherwise land in main().catch() and be miscategorized as an
      // internal crash (exit 2 + Sentry) instead of a user error (exit 1).
      try {
        const projectRoot = requireProjectRoot();

        const strict = opts.strict ?? getConfiguredStrict(projectRoot) ?? false;

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

        // `--output` wins outright when given. Omitted defaults to console,
        // except agent context still silently auto-upgrades to compact json
        // (matches the pre-`--output` --json auto-detection behavior).
        const outputFormat =
          opts.output ?? (isAgentContext() ? "json" : "console");
        const useJson = outputFormat === "json";

        if (loadResults.length === 0) {
          // Advisory diagnostics are corpus-wide, not rule-scoped: collect
          // them even when no rule ADR loaded, so --strict still sees
          // briefing overruns and unparseable ADRs in a prose-only (or
          // fully-unparseable) corpus. Parse results are cached per process,
          // so this costs no extra I/O.
          const { briefingWarnings, unparsedAdrs } =
            await collectBriefingDiagnostics(projectRoot);
          const emptyResult: CheckResult = {
            results: [],
            totalDurationMs: 0,
            briefingWarnings,
            unparsedAdrs,
          };
          const summary = buildSummary(emptyResult, { strict });
          if (outputFormat === "sarif") {
            reportSarif(emptyResult, summary);
          } else if (outputFormat === "github") {
            reportCI(emptyResult, summary);
          } else if (useJson) {
            reportJSON(
              emptyResult,
              opts.output === "json" ? true : undefined,
              summary,
              opts.verbose ?? false
            );
          } else {
            console.log("  No rules to check.");
            if (briefingWarnings.length > 0 || unparsedAdrs.length > 0) {
              reportConsole(emptyResult, opts.verbose ?? false, summary);
            }
          }
          if (strict && summary.strictAdvisoryExceeded) {
            logWarn(
              "--strict: failing because advisory findings (briefing budget or unparsed ADRs) exist even though no rules ran."
            );
          }
          await exitWith(getExitCode(emptyResult, summary));
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

        // Build the summary once and share it with the reporters, telemetry,
        // and exit-code resolver — one walk over the result set instead of
        // one per consumer.
        const summary = buildSummary(result, { strict });

        if (outputFormat === "sarif") {
          reportSarif(result, summary);
        } else if (outputFormat === "github") {
          reportCI(result, summary);
        } else if (useJson) {
          reportJSON(
            result,
            opts.output === "json" ? true : undefined,
            summary,
            opts.verbose ?? false
          );
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
          used_strict: opts.strict !== undefined,
          files_scanned: filterFiles.length,
          load_duration_ms: loadDurationMs,
          check_duration_ms: Math.round(result.totalDurationMs),
          languages: stack?.languages,
          runtimes: stack?.runtimes,
          frameworks: stack?.frameworks,
        });

        // ARCH-026: a --strict-driven failure gets a stderr explanation,
        // mirroring review-context.ts and adr/sync.ts.
        if (strict) {
          const strictReasons: string[] = [];
          if (summary.warningsExceeded) {
            strictReasons.push(
              `${summary.warnings} rule-severity warning(s) are treated as failures under --strict`
            );
          }
          if (summary.strictAdvisoryExceeded) {
            strictReasons.push(
              "advisory findings (briefing budget, suppression, or unparsed ADRs) failed under --strict"
            );
          }
          if (strictReasons.length > 0) {
            logWarn(`--strict: failing because ${strictReasons.join("; ")}.`);
          }
        }

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
