// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { exitWith, handleCommandError } from "../../helpers/exit";
import { logError } from "../../helpers/log";
import { formatJSON } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import {
  listCopilotSessions,
  readCopilotSession,
} from "../../helpers/session-context-copilot";

const makeMaxEntriesOption = () =>
  new Option(
    "--max-entries <n>",
    "maximum entries to return (default: 200)"
  ).argParser((val) => Math.trunc(Number(val)));

export function registerCopilotSessionContextCommand(parent: Command) {
  const cmd = parent
    .command("copilot")
    .description(
      "Read the current Copilot CLI session transcript for the project"
    )
    .addOption(makeMaxEntriesOption())
    .action(async (opts) => {
      try {
        const projectRoot = findProjectRoot();
        const result = await readCopilotSession(projectRoot, {
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
    .description("List available Copilot CLI sessions for the project")
    .action(async () => {
      try {
        const projectRoot = findProjectRoot();
        const result = await listCopilotSessions(projectRoot);

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
    .description("Read a specific Copilot CLI session by UUID")
    .argument("<session-id>", "session UUID from `list`")
    .addOption(makeMaxEntriesOption())
    .action(async (sessionId, opts) => {
      try {
        const projectRoot = findProjectRoot();
        const result = await readCopilotSession(projectRoot, {
          maxEntries: opts.maxEntries,
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
