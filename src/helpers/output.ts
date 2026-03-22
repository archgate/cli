/**
 * Output format detection for agent vs human contexts.
 *
 * When stdout is not a TTY (piped), the CLI is likely being called by an AI agent.
 * In that case, we auto-switch to compact JSON to reduce token usage.
 * CI environments (which are also non-TTY) are excluded — they use human-readable
 * or --ci annotation output.
 */

/**
 * Returns true when the CLI is likely being invoked by an AI agent:
 * stdout is not a TTY AND not running in a CI environment.
 */
export function isAgentContext(): boolean {
  return !process.stdout.isTTY && !Bun.env.CI;
}

/**
 * Serialize data to JSON with context-aware formatting:
 * - Agent context (non-TTY, non-CI): compact (no whitespace) to minimize tokens
 * - Human context (TTY or explicit --json): pretty-printed with 2-space indent
 */
export function formatJSON(data: unknown, forcePretty?: boolean): string {
  const pretty = forcePretty ?? !isAgentContext();
  return JSON.stringify(data, null, pretty ? 2 : undefined);
}
