// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";
import { InvalidArgumentError, Option } from "@commander-js/extra-typings";

import { exitWith, handleCommandError } from "../helpers/exit";
import { DETECTED_HARNESSES } from "../helpers/harness-detect";
import type { DetectedHarness } from "../helpers/harness-detect";
import { logError } from "../helpers/log";
import { formatJSON } from "../helpers/output";
import { findProjectRoot } from "../helpers/paths";
import {
  listAutoSessions,
  readAutoSession,
  readAutoSessionById,
} from "../helpers/session-context-auto";

/**
 * Shared `--editor` option. Omitted, the editor is resolved from the
 * environment of the AI editor running the command.
 *
 * Choices come from the detection layer's own list, so `--editor` can neither
 * offer an editor detection does not know nor omit one it does.
 */
const makeEditorOption = () =>
  new Option(
    "--editor <name>",
    "editor to read (default: detected from the environment)"
  ).choices(DETECTED_HARNESSES);

/**
 * Parse `--max-entries`, rejecting non-numeric or non-positive input — a NaN
 * limit would silently disable transcript trimming downstream.
 *
 * @throws {InvalidArgumentError} When the value is not a positive integer.
 */
export function parseMaxEntries(val: string): number {
  const n = Math.trunc(Number(val));
  if (!Number.isFinite(n) || n < 1) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return n;
}

/** Shared `--max-entries` option. */
const makeMaxEntriesOption = () =>
  new Option(
    "--max-entries <n>",
    "maximum entries to return (default: 200)"
  ).argParser(parseMaxEntries);

interface SharedOptions {
  maxEntries?: number;
  editor?: DetectedHarness;
  root?: boolean;
}

/**
 * Merge an option declared on both `session-context` and its subcommand.
 * Commander hoists parent-known options from anywhere on the command line, so
 * the flag is often parsed by the parent; the child value wins when present.
 * Every option both levels declare must be read through this, or the parent
 * silently swallows it and the subcommand sees `undefined`.
 */
function withGlobals<K extends keyof SharedOptions>(
  key: K,
  opts: SharedOptions,
  command: { optsWithGlobals: () => SharedOptions }
) {
  return opts[key] ?? command.optsWithGlobals()[key];
}

export function registerSessionContextCommand(program: Command) {
  const cmd = program
    .command("session-context")
    .description(
      "Read the current AI editor session transcript for the project"
    )
    .addOption(makeEditorOption())
    .addOption(makeMaxEntriesOption())
    .option(
      "--root",
      "opencode only: resolve a sub-agent child session up to its top-level ancestor"
    )
    .action(async (opts) => {
      try {
        const projectRoot = findProjectRoot();
        const result = await readAutoSession(projectRoot, {
          maxEntries: opts.maxEntries,
          editor: opts.editor,
          root: opts.root,
        });

        if (!result.ok) {
          logError(result.error);
          await exitWith(1);
          return;
        }

        console.log(
          formatJSON({ detection: result.detection, ...result.data })
        );
      } catch (err) {
        await handleCommandError(err);
      }
    });

  cmd
    .command("list")
    .description("List available sessions for the project")
    .addOption(makeEditorOption())
    .action(async (opts, command) => {
      try {
        const projectRoot = findProjectRoot();
        const result = await listAutoSessions(projectRoot, {
          editor: withGlobals("editor", opts, command),
        });

        if (!result.ok) {
          logError(result.error);
          await exitWith(1);
          return;
        }

        console.log(
          formatJSON({ detection: result.detection, sessions: result.sessions })
        );
      } catch (err) {
        await handleCommandError(err);
      }
    });

  cmd
    .command("show")
    .description("Read a specific session by ID")
    .argument("<session-id>", "session ID from `list`")
    .addOption(makeEditorOption())
    .addOption(makeMaxEntriesOption())
    .option(
      "--root",
      "opencode only: resolve a sub-agent child session up to its top-level ancestor"
    )
    .action(async (sessionId, opts, command) => {
      try {
        const projectRoot = findProjectRoot();
        const result = await readAutoSessionById(projectRoot, sessionId, {
          maxEntries: withGlobals("maxEntries", opts, command),
          editor: withGlobals("editor", opts, command),
          root: withGlobals("root", opts, command),
        });

        if (!result.ok) {
          logError(result.error);
          await exitWith(1);
          return;
        }

        console.log(
          formatJSON({ detection: result.detection, ...result.data })
        );
      } catch (err) {
        await handleCommandError(err);
      }
    });
}
