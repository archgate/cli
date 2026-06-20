// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";

import { buildReviewContext } from "../engine/context";
import { resolveBaseRef } from "../engine/git-files";
import { exitWith, handleCommandError } from "../helpers/exit";
import { logError } from "../helpers/log";
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
      const resolvedBase = await resolveBaseRef(projectRoot, {
        staged: opts.staged,
        base: opts.base,
        configBase: getConfiguredBaseBranch(projectRoot),
      });

      try {
        const context = await buildReviewContext(projectRoot, {
          staged: opts.staged,
          base: resolvedBase,
          runChecks: opts.runChecks,
          domain: opts.domain,
        });

        console.log(formatJSON(context));
      } catch (err) {
        await handleCommandError(err);
      }
    });
}
