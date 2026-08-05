// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as astSupport from "../../src/engine/ast-support";
import type { LoadResult } from "../../src/engine/loader";
import { runChecks } from "../../src/engine/runner";
import type { AdrDocument } from "../../src/formats/adr";
import type { RuleSet } from "../../src/formats/rules";
import { safeRmSync } from "../test-utils";

// Failure paths of the rule runner: a missing interpreter and the per-rule
// timeout. Happy paths live in runner.test.ts.

/** Placeholder callback for a promise/timer that must never do anything. */
function noop(): void {
  // Intentionally empty.
}

function makeLoadedAdr(
  ruleSet: RuleSet,
  overrides: Partial<AdrDocument["frontmatter"]> = {}
): LoadResult {
  return {
    type: "loaded",
    value: {
      adr: {
        frontmatter: {
          id: "ERR-001",
          title: "Runner Error Paths",
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

describe("runChecks failure paths", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-runner-errors-"));
    mkdirSync(join(tempDir, "src"), { recursive: true });
  });

  afterEach(() => {
    safeRmSync(tempDir);
  });

  test("ctx.ast reports a missing interpreter as a rule error", async () => {
    writeFileSync(join(tempDir, "src", "app.py"), "x = 1\n");
    const probeSpy = spyOn(astSupport, "probeInterpreter").mockResolvedValue(
      null
    );

    try {
      const loaded = makeLoadedAdr({
        rules: {
          "parse-python": {
            description: "Parse a Python file",
            async check(ctx) {
              await ctx.ast("src/app.py", "python");
            },
          },
        },
      });

      const result = await runChecks(tempDir, [loaded]);

      expect(result.results[0].error).toContain(
        "Python interpreter not found on PATH"
      );
      expect(result.results[0].error).toContain("src/app.py");
    } finally {
      probeSpy.mockRestore();
    }
  });

  test("a rule that never settles is failed by the per-rule timeout", async () => {
    // Fire the runner's own 30s timer synchronously so the race resolves to
    // the timeout deterministically, without holding the suite for 30
    // seconds. Every other delay passes through to the real timer.
    const realSetTimeout = globalThis.setTimeout;
    const timerSpy = spyOn(globalThis, "setTimeout");
    // The replacement deliberately does not match setTimeout's overloads —
    // it forwards everything it does not intercept to the real one.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    timerSpy.mockImplementation(((fn: () => void, ms?: number) => {
      if (ms !== 30_000) return realSetTimeout(fn, ms);
      fn();
      return realSetTimeout(noop, 0);
    }) as unknown as typeof setTimeout);

    try {
      const loaded = makeLoadedAdr({
        rules: {
          "never-settles": {
            description: "A rule whose check never resolves",
            async check() {
              await new Promise<void>(noop);
            },
          },
        },
      });

      const result = await runChecks(tempDir, [loaded]);

      expect(result.results[0].error).toBe(
        "Rule never-settles timed out after 30000ms"
      );
      expect(result.results[0].violations).toHaveLength(0);
    } finally {
      timerSpy.mockRestore();
    }
  });
});
