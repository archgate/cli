// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LoadResult } from "../../src/engine/loader";
import { runChecks } from "../../src/engine/runner";
import type { AdrDocument } from "../../src/formats/adr";
import type { RuleSet } from "../../src/formats/rules";
import { safeRmSync } from "../test-utils";

// A rule's time budget covers its own work only: heavy neighbouring ADRs,
// whether CPU-bound or allocation-bound, never push a light rule over it.

// Per-rule budget injected into runChecks, small enough to be exceeded by the
// combined work of the heavy ADRs.
const RULE_BUDGET_MS = 400;
// Upper bound for the light rule: generous for a loaded CI runner, and far
// below the combined heavy work that a shared clock would charge it.
const LIGHT_RULE_MAX_MS = RULE_BUDGET_MS / 4;
// ADRs in the memory-pressure batch.
const MEMORY_ADR_COUNT = 8;
// Synchronous CPU time each CPU-pressure ADR burns.
const CPU_SPIN_MS = 100;
// Size of one retained buffer per memory-pressure ADR.
const RETAINED_BUFFER_BYTES = 24 * 1024 * 1024;
// Short-lived objects each memory-pressure ADR allocates to churn the GC.
const GC_CHURN_OBJECTS = 400_000;

function makeLoadedAdr(
  ruleSet: RuleSet,
  overrides: Partial<AdrDocument["frontmatter"]> = {}
): LoadResult {
  return {
    type: "loaded",
    value: {
      adr: {
        frontmatter: {
          id: "PRESS-000",
          title: "Runner Pressure",
          domain: "general",
          rules: true,
          ...overrides,
        },
        body: "",
        filePath: "/test.md",
      },
      ruleSet,
    },
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Busy-loops for a wall-clock duration, never an iteration count, so slow
// runners spend the same time as fast ones.
function spinFor(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // Synchronous CPU work.
  }
}

// The light rule yields twice. A timeout timer that expires while the rule
// waits for other work fires before a later yield resolves, so a budget that
// counted other rules' work would report this rule as timed out. See
// archgate/cli#630.
const lightAdr = makeLoadedAdr(
  {
    rules: {
      light: {
        description: "Yields twice and does no work",
        async check() {
          await sleep(0);
          await sleep(0);
        },
      },
    },
  },
  { id: "PRESS-LIGHT" }
);

describe("runChecks under pressure", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-runner-pressure-"));
    mkdirSync(join(tempDir, "src"), { recursive: true });
  });

  afterEach(() => {
    safeRmSync(tempDir);
  });

  test("CPU pressure from other ADRs does not consume a light rule's time budget", async () => {
    const heavyAdrs = Array.from({ length: 8 }, (_, i) =>
      makeLoadedAdr(
        {
          rules: {
            heavy: {
              description: "Blocks the thread like a large parse",
              async check() {
                spinFor(CPU_SPIN_MS);
                await sleep(0);
              },
            },
          },
        },
        { id: `PRESS-CPU-${i + 1}` }
      )
    );

    const result = await runChecks(tempDir, [lightAdr, ...heavyAdrs], {
      ruleTimeoutMs: RULE_BUDGET_MS,
    });

    expect(result.results.filter((r) => r.error !== undefined)).toEqual([]);
    const light = result.results.find((r) => r.adrId === "PRESS-LIGHT");
    expect(light?.durationMs).toBeLessThan(LIGHT_RULE_MAX_MS);
    const heavyDurations = result.results
      .filter((r) => r.adrId.startsWith("PRESS-CPU-"))
      .map((r) => r.durationMs);
    expect(heavyDurations).toHaveLength(8);
    // Each heavy rule is charged its own spin and nothing beyond its budget.
    expect(
      heavyDurations.filter(
        (ms) => ms < CPU_SPIN_MS - 10 || ms >= RULE_BUDGET_MS
      )
    ).toEqual([]);
  });

  test("memory pressure from other ADRs does not consume a light rule's time budget", async () => {
    const retained: Uint8Array[] = [];
    const churnSizes: number[] = [];
    const heavyAdrs = Array.from({ length: MEMORY_ADR_COUNT }, (_, i) =>
      makeLoadedAdr(
        {
          rules: {
            heavy: {
              description: "Retains a large buffer and churns the GC",
              async check() {
                retained.push(new Uint8Array(RETAINED_BUFFER_BYTES).fill(1));
                const churn = Array.from(
                  { length: GC_CHURN_OBJECTS },
                  (__, n) => ({ i: n, s: String(n) })
                );
                churnSizes.push(churn.length);
                await sleep(0);
              },
            },
          },
        },
        { id: `PRESS-MEM-${i + 1}` }
      )
    );

    try {
      const result = await runChecks(tempDir, [lightAdr, ...heavyAdrs], {
        ruleTimeoutMs: RULE_BUDGET_MS,
      });

      expect(result.results.filter((r) => r.error !== undefined)).toEqual([]);
      const light = result.results.find((r) => r.adrId === "PRESS-LIGHT");
      expect(light?.durationMs).toBeLessThan(LIGHT_RULE_MAX_MS);
      const heavyDurations = result.results
        .filter((r) => r.adrId.startsWith("PRESS-MEM-"))
        .map((r) => r.durationMs);
      expect(heavyDurations).toHaveLength(MEMORY_ADR_COUNT);
      expect(heavyDurations.filter((ms) => ms >= RULE_BUDGET_MS)).toEqual([]);
      expect(retained).toHaveLength(MEMORY_ADR_COUNT);
      expect(churnSizes).toEqual(
        Array.from({ length: MEMORY_ADR_COUNT }, () => GC_CHURN_OBJECTS)
      );
    } finally {
      retained.length = 0;
    }
  });
});
