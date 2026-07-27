// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  spyOn,
  type Mock,
} from "bun:test";

import {
  buildSummary,
  reportConsole,
  reportCI,
  getExitCode,
} from "../../src/engine/reporter";
import type { CheckResult } from "../../src/engine/runner";

describe("reporter strict mode", () => {
  let logs: string[];
  let consoleSpy: Mock<typeof console.log>;

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

  describe("buildSummary", () => {
    test("any rule-severity warning sets warningsExceeded under strict", () => {
      const violations = [
        { ruleId: "r", adrId: "a", message: "w", severity: "warning" as const },
      ];
      const summary = buildSummary(makeResult({ violations }), {
        strict: true,
      });
      expect(summary.warningsExceeded).toBe(true);
      expect(summary.pass).toBe(false);
    });

    test("briefingWarnings alone triggers strictAdvisoryExceeded", () => {
      const result: CheckResult = {
        ...makeResult(),
        briefingWarnings: [
          { adrId: "A", file: "a.md", section: "Decision", length: 10, cap: 5 },
        ],
      };
      const summary = buildSummary(result, { strict: true });
      expect(summary.strictAdvisoryExceeded).toBe(true);
      expect(summary.pass).toBe(false);
    });

    test("suppressionWarnings alone triggers strictAdvisoryExceeded", () => {
      const result: CheckResult = {
        ...makeResult(),
        suppressionWarnings: [
          { message: "Unused suppression", file: "a.ts", line: 1 },
        ],
      };
      const summary = buildSummary(result, { strict: true });
      expect(summary.strictAdvisoryExceeded).toBe(true);
      expect(summary.pass).toBe(false);
    });

    test("unparsedAdrs alone triggers strictAdvisoryExceeded", () => {
      const result: CheckResult = {
        ...makeResult(),
        unparsedAdrs: ["broken.md"],
      };
      const summary = buildSummary(result, { strict: true });
      expect(summary.strictAdvisoryExceeded).toBe(true);
      expect(summary.pass).toBe(false);
    });

    test("advisory findings never affect pass when strict is not set", () => {
      const result: CheckResult = {
        ...makeResult(),
        briefingWarnings: [
          { adrId: "A", file: "a.md", section: "Decision", length: 10, cap: 5 },
        ],
        suppressionWarnings: [
          { message: "Unused suppression", file: "a.ts", line: 1 },
        ],
        unparsedAdrs: ["broken.md"],
      };
      const summary = buildSummary(result);
      expect(summary.strictAdvisoryExceeded).toBe(false);
      expect(summary.pass).toBe(true);
    });
  });

  describe("getExitCode", () => {
    test("returns 1 when only strictAdvisoryExceeded is true", () => {
      const result: CheckResult = {
        ...makeResult(),
        briefingWarnings: [
          { adrId: "A", file: "a.md", section: "Decision", length: 10, cap: 5 },
        ],
      };
      const summary = buildSummary(result, { strict: true });
      expect(summary.failed).toBe(0);
      expect(summary.ruleErrors).toBe(0);
      expect(summary.warningsExceeded).toBe(false);
      expect(summary.strictAdvisoryExceeded).toBe(true);
      expect(getExitCode(result, summary)).toBe(1);
    });
  });

  describe("reportCI", () => {
    test("outputs a strict-mode error annotation when strictAdvisoryExceeded", () => {
      const result: CheckResult = { ...makeResult(), unparsedAdrs: ["bad.md"] };
      const summary = buildSummary(result, { strict: true });
      reportCI(result, summary);
      expect(logs.join("\n")).toContain("::error title=strict-mode");
    });

    test("omits the strict-mode annotation when strict is not set", () => {
      const result: CheckResult = { ...makeResult(), unparsedAdrs: ["bad.md"] };
      reportCI(result);
      expect(logs.join("\n")).not.toContain("strict-mode");
    });
  });

  describe("reportConsole", () => {
    test("shows the --strict trailer when strictAdvisoryExceeded", () => {
      const result: CheckResult = { ...makeResult(), unparsedAdrs: ["bad.md"] };
      const summary = buildSummary(result, { strict: true });
      reportConsole(result, false, summary);
      expect(logs.join("\n")).toContain("--strict");
    });

    test("omits the --strict trailer without strict mode", () => {
      const result: CheckResult = { ...makeResult(), unparsedAdrs: ["bad.md"] };
      reportConsole(result, false);
      expect(logs.join("\n")).not.toContain("--strict");
    });
  });
});
