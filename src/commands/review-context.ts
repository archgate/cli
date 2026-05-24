// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";

import { buildReviewContext } from "../engine/context";
import { detectBaseRef } from "../engine/git-files";
import { exitWith } from "../helpers/exit";
import { logDebug, logError } from "../helpers/log";
import { formatJSON } from "../helpers/output";
import { findProjectRoot } from "../helpers/paths";
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
    .action(async (opts) => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        logError(
          "No archgate project found. Run 'archgate init' to create one."
        );
        await exitWith(1);
        return;
      }

      // Resolve base ref: --staged skips base detection
      let resolvedBase: string | undefined;
      if (!opts.staged) {
        if (typeof opts.base === "string") {
          resolvedBase = opts.base;
          logDebug("Using explicit base ref:", resolvedBase);
        } else {
          const configBase = getConfiguredBaseBranch(projectRoot);
          if (configBase) {
            resolvedBase = configBase;
            logDebug("Using configured base branch:", resolvedBase);
          } else {
            resolvedBase = (await detectBaseRef(projectRoot)) ?? undefined;
          }
        }
      }

      try {
        const context = await buildReviewContext(projectRoot, {
          staged: opts.staged,
          base: resolvedBase,
          runChecks: opts.runChecks,
          domain: opts.domain,
        });

        console.log(formatJSON(context));
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") throw err;
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });
}
