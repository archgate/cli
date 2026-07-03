// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";
import { InvalidArgumentError, Option } from "@commander-js/extra-typings";

import { exitWith, handleCommandError } from "../../helpers/exit";
import { logError } from "../../helpers/log";
import { formatJSON } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import {
  listClaudeCodeSessions,
  readClaudeCodeSession,
} from "../../helpers/session-context";

/**
 * Shared `--max-entries` option factory for the session-context commands.
 * Exported from this command file (not a helper) per the cross-command I/O
 * sharing convention. Rejects non-numeric or non-positive input — a NaN
 * limit would silently disable transcript trimming downstream.
 */
export const makeMaxEntriesOption = () =>
  new Option(
    "--max-entries <n>",
    "maximum entries to return (default: 200)"
  ).argParser((val) => {
    const n = Math.trunc(Number(val));
    if (!Number.isFinite(n) || n < 1) {
      throw new InvalidArgumentError("must be a positive integer");
    }
    return n;
  });

export function registerClaudeCodeSessionContextCommand(parent: Command) {
  const cmd = parent
    .command("claude-code")
    .description(
      "Read the current Claude Code session transcript for the project"
    )
    .addOption(makeMaxEntriesOption())
    .action(async (opts) => {
      try {
        const projectRoot = findProjectRoot();
        const result = await readClaudeCodeSession(projectRoot, {
          maxEntries: opts.maxEntries,
        });

        if (!result.ok) {
          logError(result.error);
          await exitWith(1);
          return;
        }

        console.log(formatJSON(result.data));
      } catch (err) {
        await handleCommandError(err);
      }
    });

  cmd
    .command("list")
    .description("List available Claude Code sessions for the project")
    .action(async () => {
      try {
        const projectRoot = findProjectRoot();
        const result = await listClaudeCodeSessions(projectRoot);

        if (!result.ok) {
          logError(result.error);
          await exitWith(1);
          return;
        }

        console.log(formatJSON(result.data));
      } catch (err) {
        await handleCommandError(err);
      }
    });

  cmd
    .command("show")
    .description("Read a specific Claude Code session by ID")
    .argument("<session-id>", "session ID from `list`")
    .addOption(makeMaxEntriesOption())
    .action(async (sessionId, opts, command) => {
      try {
        const projectRoot = findProjectRoot();
        // The parent editor command declares --max-entries too, and
        // commander hoists parent-known options from anywhere on the
        // command line — so the flag is usually parsed by the parent,
        // not this child. optsWithGlobals() merges the ancestor values.
        const maxEntries =
          opts.maxEntries ?? command.optsWithGlobals().maxEntries;
        const result = await readClaudeCodeSession(projectRoot, {
          maxEntries,
          sessionId,
        });

        if (!result.ok) {
          logError(result.error);
          await exitWith(1);
          return;
        }

        console.log(formatJSON(result.data));
      } catch (err) {
        await handleCommandError(err);
      }
    });
}
