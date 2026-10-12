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

// Scheduling of ADRs inside one runChecks call: ADRs run one after another so
// each rule's timing reflects its own work.

function makeLoadedAdr(
  ruleSet: RuleSet,
  overrides: Partial<AdrDocument["frontmatter"]> = {}
): LoadResult {
  return {
    type: "loaded",
    value: {
      adr: {
        frontmatter: {
          id: "SCHED-001",
          title: "Runner Scheduling",
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

describe("runChecks scheduling", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-runner-scheduling-"));
    mkdirSync(join(tempDir, "src"), { recursive: true });
  });

  afterEach(() => {
    safeRmSync(tempDir);
  });

  test("ADRs run one after another", async () => {
    const events: string[] = [];
    const first = makeLoadedAdr(
      {
        rules: {
          slow: {
            description: "Yields to the event loop",
            async check() {
              events.push("first:start");
              await sleep(20);
              events.push("first:end");
            },
          },
        },
      },
      { id: "SCHED-001" }
    );
    const second = makeLoadedAdr(
      {
        rules: {
          quick: {
            description: "Finishes immediately",
            async check() {
              events.push("second:start", "second:end");
              await sleep(0);
            },
          },
        },
      },
      { id: "SCHED-002" }
    );

    const result = await runChecks(tempDir, [first, second]);

    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
    expect(result.results.map((r) => r.adrId)).toEqual([
      "SCHED-001",
      "SCHED-002",
    ]);
  });

  test("a rule's durationMs covers only its own work", async () => {
    const lightAdr = makeLoadedAdr(
      {
        rules: {
          light: {
            description: "Yields once and does no work",
            async check() {
              await sleep(0);
            },
          },
        },
      },
      { id: "SCHED-001" }
    );
    const heavyAdr = makeLoadedAdr(
      {
        rules: {
          heavy: {
            description: "Blocks the thread like a large parse",
            async check() {
              const end = performance.now() + 100;
              while (performance.now() < end) {
                // Synchronous CPU work.
              }
              await sleep(0);
            },
          },
        },
      },
      { id: "SCHED-002" }
    );

    const result = await runChecks(tempDir, [lightAdr, heavyAdr]);

    const light = result.results.find((r) => r.adrId === "SCHED-001");
    const heavy = result.results.find((r) => r.adrId === "SCHED-002");
    expect(heavy?.durationMs).toBeGreaterThanOrEqual(80);
    expect(light?.durationMs).toBeLessThan(50);
  });
});
