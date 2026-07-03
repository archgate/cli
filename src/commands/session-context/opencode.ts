// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";

import { exitWith, handleCommandError } from "../../helpers/exit";
import { logError } from "../../helpers/log";
import { formatJSON } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import {
  listOpencodeSessions,
  readOpencodeSession,
} from "../../helpers/session-context-opencode";
import { makeMaxEntriesOption, resolveMaxEntries } from "./claude-code";

export function registerOpencodeSessionContextCommand(parent: Command) {
  const cmd = parent
    .command("opencode")
    .description("Read the current opencode session transcript for the project")
    .addOption(makeMaxEntriesOption())
    .action(async (opts) => {
      try {
        const projectRoot = findProjectRoot();
        const result = readOpencodeSession(projectRoot, {
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
    .description("List available top-level opencode sessions for the project")
    .action(async () => {
      try {
        const projectRoot = findProjectRoot();
        const result = listOpencodeSessions(projectRoot);

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
    .description("Read a specific opencode session by ID")
    .argument("<session-id>", "session ID from `list`")
    .addOption(makeMaxEntriesOption())
    .option(
      "--root",
      "resolve a sub-agent child session up to its top-level ancestor"
    )
    .action(async (sessionId, opts, command) => {
      try {
        const projectRoot = findProjectRoot();
        const result = readOpencodeSession(projectRoot, {
          maxEntries: resolveMaxEntries(opts, command),
          sessionId,
          root: opts.root,
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
