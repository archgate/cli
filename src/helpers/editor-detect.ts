// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * editor-detect.ts — Detects available editor CLIs and prompts the user to select.
 *
 * Used by commands that accept --editor to auto-detect when no flag is provided.
 * In non-TTY (agent) contexts, defaults to "claude" for backward compatibility.
 */

import { EDITOR_LABELS } from "./init-project";
import type { EditorTarget } from "./init-project";
import { logDebug } from "./log";
import {
  isClaudeCliAvailable,
  isCopilotAvailable,
  isCursorCliAvailable,
  isOpencodeAvailable,
  isVscodeCliAvailable,
} from "./plugin-install";
import { withPromptFix } from "./prompt";

export interface DetectedEditor {
  id: EditorTarget;
  label: string;
  available: boolean;
}

export async function detectEditors(): Promise<DetectedEditor[]> {
  logDebug("Detecting available editor CLIs");
  const [claude, cursor, vscode, copilot, opencode] = await Promise.all([
    isClaudeCliAvailable(),
    isCursorCliAvailable(),
    isVscodeCliAvailable(),
    isCopilotAvailable(),
    isOpencodeAvailable(),
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
 *
 * @param detected - Candidate editors; installed ones are pre-checked, the
 * rest are listed unchecked.
 * @returns At least one editor — the prompt's own validation rejects an
 * empty selection.
 */
export async function promptEditorSelection(
  detected: DetectedEditor[]
): Promise<EditorTarget[]> {
  // Lazy-load inquirer — it costs ~200ms to parse and is only needed when
  // the user is interactively prompted, not on every CLI startup.
  const { default: inquirer } = await import("inquirer");
  const questions = [
    {
      type: "checkbox" as const,
      name: "selected" as const,
      message: "Select editors to configure:",
      choices: detected.map((e) => ({
        name: e.available ? `${e.label} (detected)` : e.label,
        value: e.id,
        checked: e.available,
      })),
      validate: (input: EditorTarget[]) =>
        input.length > 0 || "Select at least one editor.",
    },
  ];
  const { selected } = await withPromptFix<{ selected: EditorTarget[] }>(
    async () => inquirer.prompt<{ selected: EditorTarget[] }>(questions)
  );
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

  const questions = [
    {
      type: "select" as const,
      name: "selected" as const,
      message: "Select editor:",
      choices: detected.map((e) => ({
        name: e.available ? `${e.label} (detected)` : e.label,
        value: e.id,
      })),
      default: defaultEditor,
    },
  ];
  const { selected } = await withPromptFix<{ selected: EditorTarget }>(
    async () => inquirer.prompt<{ selected: EditorTarget }>(questions)
  );
  return selected;
}
