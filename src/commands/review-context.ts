// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { buildReviewContext } from "../engine/context";
import { resolveBaseRef } from "../engine/git-files";
import { rejectBlank } from "../helpers/cli-options";
import { exitWith, handleCommandError } from "../helpers/exit";
import { logWarn } from "../helpers/log";
import { formatJSON } from "../helpers/output";
import { requireProjectRoot } from "../helpers/paths";
import {
  getConfiguredBaseBranch,
  getConfiguredStrict,
} from "../helpers/project-config";

export function registerReviewContextCommand(program: Command) {
  program
    .command("review-context")
    .description(
      "Pre-compute review context with ADR briefings for changed files"
    )
    .option("--staged", "Only include git-staged files")
    .addOption(
      new Option(
        "--base [ref]",
        "Compare changed files against a base ref (auto-detects when omitted)"
      ).argParser(rejectBlank)
    )
    .option("--run-checks", "Include ADR compliance check results")
    .addOption(
      new Option("--domain <domain>", "Filter to a single domain").argParser(
        rejectBlank
      )
    )
    .option(
      "--verbose",
      "Include each ADR's Decision and Do's/Don'ts prose (large; omitted by default — use `archgate adr show <id>` to drill down)"
    )
    .option(
      "--strict",
      "Exit 1 when ADR briefings were truncated or, with --run-checks, when check found strict-relevant findings"
    )
    .action(async (opts) => {
      try {
        const projectRoot = requireProjectRoot();
        const strict = opts.strict ?? getConfiguredStrict(projectRoot) ?? false;
        // Resolve base ref: --staged skips base detection
        const resolvedBase = await resolveBaseRef(projectRoot, {
          staged: opts.staged,
          base: opts.base,
          configBase: getConfiguredBaseBranch(projectRoot),
        });

        const context = await buildReviewContext(projectRoot, {
          staged: opts.staged,
          base: resolvedBase,
          runChecks: opts.runChecks,
          domain: opts.domain,
          // `--verbose` matches `check --verbose` ("give me the full detail")
          // as the user-facing name; the engine option stays `briefings`
          // because that names what is actually included.
          briefings: opts.verbose,
          strict,
        });

        // Truncation hides governing text, so it is announced on stderr as
        // well as flagged in the payload (ARCH-003 §5) — a consumer reading
        // only the JSON still sees it, and one watching the terminal is told.
        if (context.truncatedBriefings.length > 0) {
          logWarn(
            `ADR briefing prose truncated for ${context.truncatedBriefings.join(", ")} — Decision and/or Do's and Don'ts are incomplete. Read the full text with \`archgate adr show <id>\`.`
          );
        }
        if (context.truncatedFiles) {
          logWarn(
            `Changed-file list truncated to ${context.allChangedFiles.length} files — files beyond that limit are absent from this context.`
          );
        }
        if (context.checkSummary?.truncated === true) {
          logWarn(
            "Some rules reported more violations than the per-rule cap — the extra violations are absent from `checkSummary`. Run `archgate check` for the complete list."
          );
        }

        console.log(formatJSON(context));

        // Full context is already printed (above), so a piped consumer still
        // gets it on a strict failure. Deliberately not gated on
        // checkSummary.failed/ruleErrors — `check` remains the gate for
        // ordinary rule violations; this only fails on findings this command
        // itself surfaces.
        if (strict) {
          const strictReasons: string[] = [];
          if (context.truncatedBriefings.length > 0) {
            strictReasons.push("ADR briefing prose was truncated");
          }
          if (context.checkSummary?.warningsExceeded === true) {
            strictReasons.push(
              `${context.checkSummary.warnings} check warning(s) are treated as failures under --strict`
            );
          }
          if (context.checkSummary?.strictAdvisoryExceeded === true) {
            strictReasons.push(
              "check found advisory findings (briefing budget, suppression, or unparsed ADRs)"
            );
          }
          if (strictReasons.length > 0) {
            logWarn(`--strict: failing because ${strictReasons.join("; ")}.`);
            await exitWith(1);
          }
        }
      } catch (err) {
        await handleCommandError(err);
      }
    });
}
