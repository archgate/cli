/**
 * Performance regression tests for CLI startup and exit latency.
 *
 * Two concerns, two describe blocks:
 *
 * 1. **Exit tail guard** — catches leaked `setTimeout` / `Bun.sleep` that
 *    keep the event loop alive after the command completes (the ~3s tail
 *    from PR #213). Budget: 4000ms — generous, only fires on timer leaks.
 *
 * 2. **Startup latency budget** — catches import-time regressions like
 *    static `import inquirer` (costs ~200ms) or blocking telemetry init
 *    (~150ms). Budgets are ~3-4x the measured baseline so they don't
 *    flake on slow CI, but tight enough to catch a heavy dependency
 *    being pulled into the startup path.
 *
 * Strategy: run commands end-to-end via `Bun.spawn`, take the median of
 * multiple runs to smooth out cold-start variance, and assert wall-clock
 * time stays under the budget.
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

// ---------------------------------------------------------------------------
// Startup latency budgets
// ---------------------------------------------------------------------------
//
// These budgets are tighter than the exit-tail guard above. They protect
// against import-time regressions:
//
//   - Re-adding a static `import inquirer` (costs ~200ms)
//   - Blocking on telemetry/sentry init before command parsing (~150ms)
//   - Pulling a heavy new dependency into the top-level import chain
//
// Baseline (measured 2026-05-09 on Windows, subprocess via Bun.spawn):
//   --help:    ~260ms    --version: ~250ms
//   adr list:  ~400ms    check:     ~750ms
//
// Budgets are set at ~3-4x the baseline to absorb CI variance (GitHub
// Actions Windows runners are typically 1.5-2x slower than local dev)
// without masking a real regression. If a budget fires, profile the
// startup with `bun -e "..."` import-time measurements (see the commit
// that introduced these tests for the technique).

/**
 * Budget for commands that do zero project I/O — pure startup + parse +
 * exit. These exercise the full import chain but touch no .archgate/ files.
 */
const STARTUP_ONLY_MAX_MS = 1000;

/**
 * Budget for commands that do light project I/O (read + parse ADR files).
 */
const LIGHT_COMMAND_MAX_MS = 1500;

/**
 * Budget for commands that do heavy project I/O (load rules, scan files,
 * run checks).
 */
const HEAVY_COMMAND_MAX_MS = 2500;

function startupBudgetError(
  label: string,
  median: number,
  all: number[],
  budget: number
): string {
  return (
    `\`${label}\` took ${Math.round(median)}ms ` +
    `(median of ${all.map((m) => Math.round(m)).join(", ")}ms). ` +
    `Budget is ${budget}ms. ` +
    `This usually means a heavy dependency was added to the static import chain ` +
    `(e.g. inquirer, a new SDK) or an async init is blocking before command parsing. ` +
    `Profile with: bun -e "const t=performance.now(); await import('./src/...'); ` +
    `console.log(performance.now()-t)"`
  );
}

describe("CLI performance — startup latency budget", () => {
  test(
    "`--help` stays within startup budget",
    async () => {
      const { median, all } = await medianDurationMs(["--help"], 3);
      if (median >= STARTUP_ONLY_MAX_MS) {
        throw new Error(
          startupBudgetError(
            "archgate --help",
            median,
            all,
            STARTUP_ONLY_MAX_MS
          )
        );
      }
      expect(median).toBeLessThan(STARTUP_ONLY_MAX_MS);
    },
    STARTUP_ONLY_MAX_MS * 5
  );

  test(
    "`--version` stays within startup budget",
    async () => {
      const { median, all } = await medianDurationMs(["--version"], 3);
      if (median >= STARTUP_ONLY_MAX_MS) {
        throw new Error(
          startupBudgetError(
            "archgate --version",
            median,
            all,
            STARTUP_ONLY_MAX_MS
          )
        );
      }
      expect(median).toBeLessThan(STARTUP_ONLY_MAX_MS);
    },
    STARTUP_ONLY_MAX_MS * 5
  );

  test(
    "`adr list` stays within light-command budget",
    async () => {
      const { median, all } = await medianDurationMs(["adr", "list"], 3);
      if (median >= LIGHT_COMMAND_MAX_MS) {
        throw new Error(
          startupBudgetError(
            "archgate adr list",
            median,
            all,
            LIGHT_COMMAND_MAX_MS
          )
        );
      }
      expect(median).toBeLessThan(LIGHT_COMMAND_MAX_MS);
    },
    LIGHT_COMMAND_MAX_MS * 5
  );

  test(
    "`check` stays within heavy-command budget",
    async () => {
      const { median, all } = await medianDurationMs(["check"], 3);
      if (median >= HEAVY_COMMAND_MAX_MS) {
        throw new Error(
          startupBudgetError(
            "archgate check",
            median,
            all,
            HEAVY_COMMAND_MAX_MS
          )
        );
      }
      expect(median).toBeLessThan(HEAVY_COMMAND_MAX_MS);
    },
    HEAVY_COMMAND_MAX_MS * 5
  );
});
