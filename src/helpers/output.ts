// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Output format detection for agent vs human contexts.
 *
 * When stdout is not a TTY (piped), the CLI is likely being called by an AI agent.
 * In that case, we auto-switch to compact JSON to reduce token usage.
 * CI environments (which are also non-TTY) are excluded — they use human-readable
 * or --ci annotation output.
 */

/**
 * Detect whether the CLI is likely being driven by an AI agent.
 *
 * @returns `true` when stdout is not a TTY and no CI environment is detected.
 */
export function isAgentContext(): boolean {
  return !process.stdout.isTTY && !Bun.env.CI;
}

/**
 * Serialize data to JSON with context-aware formatting.
 *
 * @param data - The value to serialize.
 * @param forcePretty - When true, always pretty-print (e.g. an explicit
 * `--json` flag). Defaults to pretty-printing outside agent contexts.
 * @returns Compact JSON in agent contexts (non-TTY, non-CI) to minimize
 * tokens, otherwise JSON indented with 2 spaces.
 */
export function formatJSON(data: unknown, forcePretty?: boolean): string {
  const pretty = forcePretty ?? !isAgentContext();
  return JSON.stringify(data, null, pretty ? 2 : undefined);
}
