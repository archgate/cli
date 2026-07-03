// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";

import { exitWith, handleCommandError } from "../../helpers/exit";
import { logError } from "../../helpers/log";
import { formatJSON } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import {
  listCursorSessions,
  readCursorSession,
} from "../../helpers/session-context";
import { makeMaxEntriesOption } from "./claude-code";

export function registerCursorSessionContextCommand(parent: Command) {
  const cmd = parent
    .command("cursor")
    .description(
      "Read the current Cursor agent session transcript for the project"
    )
    .addOption(makeMaxEntriesOption())
    .action(async (opts) => {
      try {
        const projectRoot = findProjectRoot();
        const result = await readCursorSession(projectRoot, {
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
    .description("List available Cursor agent sessions for the project")
    .action(async () => {
      try {
        const projectRoot = findProjectRoot();
        const result = await listCursorSessions(projectRoot);

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
    .description("Read a specific Cursor agent session by UUID")
    .argument("<session-id>", "session UUID from `list`")
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
        const result = await readCursorSession(projectRoot, {
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
