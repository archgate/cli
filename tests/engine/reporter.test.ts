// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";

import {
  buildSummary,
  reportConsole,
  reportJSON,
  reportCI,
  getExitCode,
} from "../../src/engine/reporter";
import type { CheckResult } from "../../src/engine/runner";

describe("reporter", () => {
  let logs: string[];
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logs = [];
    consoleSpy = spyOn(console, "log").mockImplementation(
      (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      }
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function makeResult(
    overrides: Partial<CheckResult["results"][0]> = {}
  ): CheckResult {
    return {
      results: [
        {
          ruleId: "test-rule",
          adrId: "TEST-001",
          description: "A test rule",
          violations: [],
          durationMs: 10,
          ...overrides,
        },
      ],
      totalDurationMs: 15,
    };
  }

  describe("getExitCode", () => {
    test("returns 0 when all rules pass", () => {
      expect(getExitCode(makeResult())).toBe(0);
    });

    test("returns 1 when there are error violations", () => {
      const result = makeResult({
        violations: [
          { ruleId: "r", adrId: "a", message: "bad", severity: "error" },
        ],
      });
      expect(getExitCode(result)).toBe(1);
    });

    test("returns 0 when only warnings present", () => {
      const result = makeResult({
        violations: [
          { ruleId: "r", adrId: "a", message: "meh", severity: "warning" },
        ],
      });
      expect(getExitCode(result)).toBe(0);
    });

    test("returns 2 when rule has execution error", () => {
      const result = makeResult({ error: "kaboom" });
      expect(getExitCode(result)).toBe(2);
    });
  });

  describe("reportJSON", () => {
    test("outputs valid JSON", () => {
      reportJSON(makeResult());
      const output = logs.join("\n");
      const parsed = JSON.parse(output);
      expect(parsed.pass).toBe(true);
      expect(parsed.total).toBe(1);
      expect(parsed.passed).toBe(1);
    });

    test("includes violations in JSON output", () => {
      reportJSON(
        makeResult({
          violations: [
            {
              ruleId: "r",
              adrId: "a",
              message: "problem",
              file: "src/foo.ts",
              line: 5,
              severity: "error",
            },
          ],
        })
      );
      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.pass).toBe(false);
      expect(parsed.results[0].violations[0].message).toBe("problem");
    });
  });

  describe("reportCI", () => {
    test("outputs GitHub Actions annotations for errors", () => {
      reportCI(
        makeResult({
          violations: [
            {
              ruleId: "r",
              adrId: "a",
              message: "violation msg",
              file: "src/foo.ts",
              line: 10,
              severity: "error",
            },
          ],
        })
      );
      expect(logs.some((l) => l.includes("::error"))).toBe(true);
      expect(logs.some((l) => l.includes("file=src/foo.ts"))).toBe(true);
      expect(logs.some((l) => l.includes("line=10"))).toBe(true);
    });

    test("outputs warning annotations", () => {
      reportCI(
        makeResult({
          violations: [
            {
              ruleId: "r",
              adrId: "a",
              message: "warn msg",
              severity: "warning",
            },
          ],
        })
      );
      expect(logs.some((l) => l.includes("::warning"))).toBe(true);
    });

    test("outputs notice for info severity", () => {
      reportCI(
        makeResult({
          violations: [
            { ruleId: "r", adrId: "a", message: "info msg", severity: "info" },
          ],
        })
      );
      expect(logs.some((l) => l.includes("::notice"))).toBe(true);
    });
  });

  describe("reportConsole", () => {
    test("outputs passing summary", () => {
      reportConsole(makeResult(), false);
      expect(logs.some((l) => l.includes("passed"))).toBe(true);
    });

    test("outputs failing violations", () => {
      reportConsole(
        makeResult({
          violations: [
            {
              ruleId: "r",
              adrId: "a",
              message: "bad thing",
              severity: "error",
            },
          ],
        }),
        false
      );
      expect(logs.some((l) => l.includes("bad thing"))).toBe(true);
    });
  });

  describe("buildSummary", () => {
    test("includes totalViolations and shownViolations without cap", () => {
      const violations = Array.from({ length: 5 }, (_, i) => ({
        ruleId: "r",
        adrId: "a",
        message: `violation ${i}`,
        severity: "error" as const,
      }));
      const summary = buildSummary(makeResult({ violations }));
      expect(summary.results[0].totalViolations).toBe(5);
      expect(summary.results[0].shownViolations).toBe(5);
      expect(summary.results[0].violations).toHaveLength(5);
      expect(summary.truncated).toBe(false);
    });

    test("caps violations when maxViolationsPerRule is set", () => {
      const violations = Array.from({ length: 50 }, (_, i) => ({
        ruleId: "r",
        adrId: "a",
        message: `violation ${i}`,
        severity: "error" as const,
      }));
      const summary = buildSummary(makeResult({ violations }), {
        maxViolationsPerRule: 10,
      });
      expect(summary.results[0].totalViolations).toBe(50);
      expect(summary.results[0].shownViolations).toBe(10);
      expect(summary.results[0].violations).toHaveLength(10);
      expect(summary.truncated).toBe(true);
    });

    test("keeps first N violations in order when capping", () => {
      const violations = Array.from({ length: 30 }, (_, i) => ({
        ruleId: "r",
        adrId: "a",
        message: `v-${i}`,
        severity: "error" as const,
      }));
      const summary = buildSummary(makeResult({ violations }), {
        maxViolationsPerRule: 3,
      });
      expect(summary.results[0].violations[0].message).toBe("v-0");
      expect(summary.results[0].violations[1].message).toBe("v-1");
      expect(summary.results[0].violations[2].message).toBe("v-2");
    });

    test("counts ALL violations for totals even when capped", () => {
      const violations = Array.from({ length: 25 }, (_, i) => ({
        ruleId: "r",
        adrId: "a",
        message: `v-${i}`,
        severity: "error" as const,
      }));
      const summary = buildSummary(makeResult({ violations }), {
        maxViolationsPerRule: 5,
      });
      // errors count should reflect ALL 25 violations, not just the shown 5
      expect(summary.errors).toBe(25);
      expect(summary.results[0].shownViolations).toBe(5);
    });

    test("does not truncate when violations equal the cap", () => {
      const violations = Array.from({ length: 10 }, (_, i) => ({
        ruleId: "r",
        adrId: "a",
        message: `v-${i}`,
        severity: "warning" as const,
      }));
      const summary = buildSummary(makeResult({ violations }), {
        maxViolationsPerRule: 10,
      });
      expect(summary.results[0].totalViolations).toBe(10);
      expect(summary.results[0].shownViolations).toBe(10);
      expect(summary.truncated).toBe(false);
    });

    test("maxViolationsPerRule 0 means unlimited", () => {
      const violations = Array.from({ length: 100 }, (_, i) => ({
        ruleId: "r",
        adrId: "a",
        message: `v-${i}`,
        severity: "error" as const,
      }));
      const summary = buildSummary(makeResult({ violations }), {
        maxViolationsPerRule: 0,
      });
      expect(summary.results[0].violations).toHaveLength(100);
      expect(summary.truncated).toBe(false);
    });
  });
});
