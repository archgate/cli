// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * editor-detect.ts — Detects available editor CLIs and prompts the user to select.
 *
 * Used by commands that accept --editor to auto-detect when no flag is provided.
 * In non-TTY (agent) contexts, defaults to "claude" for backward compatibility.
 */

import { cursorTo } from "node:readline";

import { EDITOR_LABELS } from "./init-project";
import type { EditorTarget } from "./init-project";
import { logDebug } from "./log";
import { resolveCommand } from "./platform";
import {
  isClaudeCliAvailable,
  isCopilotCliAvailable,
  isOpencodeCliAvailable,
  isVscodeCliAvailable,
} from "./plugin-install";

/** Result of editor availability detection. */
export interface DetectedEditor {
  id: EditorTarget;
  label: string;
  available: boolean;
}

/**
 * Detect which editor CLIs are available on PATH.
 * Runs all checks in parallel for speed.
 */
export async function detectEditors(): Promise<DetectedEditor[]> {
  logDebug("Detecting available editor CLIs");
  const [claude, cursor, vscode, copilot, opencode] = await Promise.all([
    isClaudeCliAvailable(),
    resolveCommand("cursor").then((r) => r !== null),
    isVscodeCliAvailable(),
    isCopilotCliAvailable(),
    isOpencodeCliAvailable(),
  ]);

  logDebug("Editor detection:", { claude, cursor, vscode, copilot, opencode });
  return [
    { id: "claude" as const, label: EDITOR_LABELS.claude, available: claude },
    { id: "cursor" as const, label: EDITOR_LABELS.cursor, available: cursor },
    { id: "vscode" as const, label: EDITOR_LABELS.vscode, available: vscode },
    {
      id: "copilot" as const,
      label: EDITOR_LABELS.copilot,
      available: copilot,
    },
    {
      id: "opencode" as const,
      label: EDITOR_LABELS.opencode,
      available: opencode,
    },
  ];
}

/**
 * Prompt the user to select one or more editors from the detected list.
 * Detected editors are pre-checked; unavailable ones are shown but unchecked.
 * Returns at least one selection (validation enforced).
 */
export async function promptEditorSelection(
  detected: DetectedEditor[]
): Promise<EditorTarget[]> {
  // Lazy-load inquirer — it costs ~200ms to parse and is only needed when
  // the user is interactively prompted, not on every CLI startup.
  const { default: inquirer } = await import("inquirer");
  const { selected } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "selected",
      message: "Select editors to configure:",
      choices: detected.map((e) => ({
        name: e.available ? `${e.label} (detected)` : `${e.label}`,
        value: e.id,
        checked: e.available,
      })),
      validate: (input: EditorTarget[]) =>
        input.length > 0 || "Select at least one editor.",
    },
  ]);
  // On Windows, inquirer leaves the cursor at the end of the wrapped answer
  // line. Subsequent output calls inherit that column offset instead of
  // starting at column 0. Explicitly reset the cursor to prevent garbled output.
  if (process.stdout.isTTY) cursorTo(process.stdout, 0);
  return selected;
}

/**
 * Prompt the user to select a single editor.
 * Used by commands that operate on one editor at a time (e.g., plugin url).
 */
export async function promptSingleEditorSelection(
  detected: DetectedEditor[]
): Promise<EditorTarget> {
  const { default: inquirer } = await import("inquirer");
  const available = detected.filter((e) => e.available);
  const defaultEditor = available.length > 0 ? available[0].id : "claude";

  const { selected } = await inquirer.prompt([
    {
      type: "list",
      name: "selected",
      message: "Select editor:",
      choices: detected.map((e) => ({
        name: e.available ? `${e.label} (detected)` : e.label,
        value: e.id,
      })),
      default: defaultEditor,
    },
  ]);
  // Same Windows cursor-reset fix as promptEditorSelection above.
  if (process.stdout.isTTY) cursorTo(process.stdout, 0);
  return selected;
}
