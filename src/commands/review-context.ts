// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";

import { buildReviewContext } from "../engine/context";
import { resolveBaseRef } from "../engine/git-files";
import { handleCommandError } from "../helpers/exit";
import { logWarn } from "../helpers/log";
import { formatJSON } from "../helpers/output";
import { requireProjectRoot } from "../helpers/paths";
import { getConfiguredBaseBranch } from "../helpers/project-config";

export function registerReviewContextCommand(program: Command) {
  program
    .command("review-context")
    .description(
      "Pre-compute review context with ADR briefings for changed files"
    )
    .option("--staged", "Only include git-staged files")
    .option(
      "--base [ref]",
      "Compare changed files against a base ref (auto-detects when omitted)"
    )
    .option("--run-checks", "Include ADR compliance check results")
    .option("--domain <domain>", "Filter to a single domain")
    .option(
      "--verbose",
      "Include each ADR's Decision and Do's/Don'ts prose (large; omitted by default — use `archgate adr show <id>` to drill down)"
    )
    .action(async (opts) => {
      try {
        const projectRoot = requireProjectRoot();
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
        if (context.checkSummary?.truncated) {
          logWarn(
            "Some rules reported more violations than the per-rule cap — the extra violations are absent from `checkSummary`. Run `archgate check` for the complete list."
          );
        }

        console.log(formatJSON(context));
      } catch (err) {
        await handleCommandError(err);
      }
    });
}
