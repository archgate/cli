// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Performance regression tests for CLI startup and exit latency.
 *
 * One describe block guards the exit tail against leaked timers holding the
 * event loop open; the other guards startup against import-time cost such as
 * a static `inquirer` import. Commands run end-to-end via `Bun.spawn`, taking
 * the median of several runs against a budget set well above baseline.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const CLI_PATH = resolve(import.meta.dir, "..", "..", "src", "cli.ts");

/**
 * Ceiling for a trivially-fast command. Normal runs sit well under 2s even on
 * slow CI, while a leaked exit-path timer pushes them to 3.5-4s, so 4000ms
 * separates the two with headroom.
 *
 * @see https://github.com/archgate/cli/pull/213 — the leak this budget guards
 */
const FAST_COMMAND_MAX_MS = 4000;

/**
 * Run the CLI with the given args and return the wall-clock duration.
 *
 * `NODE_ENV=test` suppresses event capture, so no real traffic is sent while
 * the telemetry and Sentry SDKs still initialize and flush — the path a timer
 * leak lives on. `ARCHGATE_TELEMETRY` stays unset to exercise the enabled path.
 *
 * @param args - Arguments passed to the CLI after the script path.
 * @returns Wall-clock milliseconds from spawn to process exit.
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
// Tighter than the exit-tail guard above, these protect against import-time
// cost: a static `import inquirer` (~200ms), blocking telemetry init (~150ms),
// or a heavy dependency entering the top-level import chain. Each sits at
// ~3-4x its measured baseline so CI variance cannot mask a real regression.

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
