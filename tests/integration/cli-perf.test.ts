/**
 * Performance regression tests — guard against the "un-cancelled timer"
 * class of bugs that added a 3-second tail to every command that exits
 * naturally through `main()` returning.
 *
 * See PR #213 for the full list of call sites fixed. The specific
 * regression this file protects against is any leaked `setTimeout` /
 * `Bun.sleep` that keeps the Bun event loop alive past its intended
 * shutdown — most commonly in telemetry / Sentry flush, the git
 * credential helper, or the WSL fallback in `resolveCommand`.
 *
 * Strategy: run short commands end-to-end via the real CLI entry
 * and assert wall-clock time stays under a generous threshold. A
 * lingering timer immediately pushes the time past the threshold
 * (the old tail was ~3s on Windows); genuinely slow runs on cold
 * CI still fit well within the budget.
 *
 * The thresholds are intentionally generous so the test doesn't
 * flake on slow runners — they're chosen to catch the *regression*
 * (commands lingering 3s+) without failing on normal CI noise.
 * Don't tighten these to assert absolute performance targets; do
 * that elsewhere if needed. The job of these tests is one thing:
 * catch the exit tail returning.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const CLI_PATH = resolve(import.meta.dir, "..", "..", "src", "cli.ts");

/**
 * Ceiling for a trivially-fast command. The historical regression
 * pushed this to 3.5–4s. Normal runs sit well under 2s even on slow
 * CI. 4000ms catches the regression with plenty of headroom.
 */
const FAST_COMMAND_MAX_MS = 4000;

/**
 * Run the CLI with the given args and return the wall-clock duration.
 * `NODE_ENV=test` suppresses actual telemetry event capture so no real
 * traffic is sent, but the telemetry / Sentry SDKs still initialize
 * and flush — which is exactly the path the timer-leak regression
 * lived on. Leaving `ARCHGATE_TELEMETRY` unset means we exercise the
 * enabled path; the `_=test` env guard inside `trackEvent` /
 * `Sentry.init`'s `enabled` flag prevents real event delivery.
 */
async function timeCli(args: string[]): Promise<number> {
  const start = performance.now();
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NO_COLOR: "1",
      NODE_ENV: "test",
      // Intentionally NOT disabling telemetry — we want the SDK init +
      // flush path to run so any leaked timer shows up as a wall-clock
      // regression. The NODE_ENV=test guard suppresses event delivery.
    },
  });

  // Drain streams so the spawn can exit cleanly even if stdout/stderr
  // fills a pipe buffer. We don't assert on content here — other tests
  // cover correctness.
  await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return performance.now() - start;
}

/** Run a command N times and return the median duration. */
async function medianDurationMs(
  args: string[],
  runs: number
): Promise<{ median: number; all: number[] }> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    // oxlint-disable-next-line no-await-in-loop -- runs are serial on purpose
    samples.push(await timeCli(args));
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { median, all: samples };
}

describe("CLI performance — exit tail regression guard", () => {
  test(
    "`--version` finishes within budget (no leaked exit-path timer)",
    async () => {
      // 3 runs + median smooths out a single slow cold-start without
      // letting a genuine regression slip through.
      const { median, all } = await medianDurationMs(["--version"], 3);
      if (median >= FAST_COMMAND_MAX_MS) {
        // Rich failure message — makes debugging fast when CI flakes.
        throw new Error(
          `\`archgate --version\` took ${Math.round(median)}ms (median of ${all.map((m) => Math.round(m)).join(", ")}ms). ` +
            `Budget is ${FAST_COMMAND_MAX_MS}ms. ` +
            `This usually means a new un-cancelled \`setTimeout\` / \`Bun.sleep\` is keeping the event loop alive after the command completes. ` +
            `Grep for \`Promise.race\` + \`setTimeout\` and make sure every timer id is captured and \`clearTimeout\`'d in a \`.finally\`.`
        );
      }
      expect(median).toBeLessThan(FAST_COMMAND_MAX_MS);
    },
    // Per-test timeout: allow 4× budget so we report a clean failure
    // rather than a timeout if something is badly wrong.
    FAST_COMMAND_MAX_MS * 4
  );

  test(
    "`--help` finishes within budget (no leaked exit-path timer)",
    async () => {
      const { median, all } = await medianDurationMs(["--help"], 3);
      if (median >= FAST_COMMAND_MAX_MS) {
        throw new Error(
          `\`archgate --help\` took ${Math.round(median)}ms (median of ${all.map((m) => Math.round(m)).join(", ")}ms). ` +
            `Budget is ${FAST_COMMAND_MAX_MS}ms. See the \`--version\` test failure message for the likely cause.`
        );
      }
      expect(median).toBeLessThan(FAST_COMMAND_MAX_MS);
    },
    FAST_COMMAND_MAX_MS * 4
  );
});
