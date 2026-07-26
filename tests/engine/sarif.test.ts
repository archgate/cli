// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import type { ReportSummary } from "../../src/engine/reporter";
import { buildSarifLog } from "../../src/engine/sarif";

function makeSummary(overrides: Partial<ReportSummary> = {}): ReportSummary {
  return {
    pass: true,
    total: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
    errors: 0,
    infos: 0,
    ruleErrors: 0,
    warningsExceeded: false,
    strictAdvisoryExceeded: false,
    truncated: false,
    suppressed: 0,
    suppressionWarnings: [],
    briefingWarnings: [],
    unparsedAdrs: [],
    results: [],
    durationMs: 0,
    ...overrides,
  };
}

describe("buildSarifLog", () => {
  test("produces a valid, empty SARIF log for an empty summary", () => {
    const log = buildSarifLog(makeSummary());
    expect(log.$schema).toBe("https://json.schemastore.org/sarif-2.1.0.json");
    expect(log.version).toBe("2.1.0");
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].tool.driver.name).toBe("archgate");
    expect(log.runs[0].tool.driver.rules).toEqual([]);
    expect(log.runs[0].results).toEqual([]);
  });

  test.each([
    ["error", "error"],
    ["warning", "warning"],
    ["info", "note"],
  ] as const)(
    "maps violation severity %s to SARIF level %s",
    (severity, level) => {
      const summary = makeSummary({
        results: [
          {
            adrId: "ARCH-001",
            ruleId: "some-rule",
            description: "Some rule",
            status: "fail",
            totalViolations: 1,
            shownViolations: 1,
            violations: [
              { message: "bad thing", file: "src/foo.ts", line: 10, severity },
            ],
            durationMs: 1,
          },
        ],
      });
      const log = buildSarifLog(summary);
      expect(log.runs[0].results).toHaveLength(1);
      expect(log.runs[0].results[0].level).toBe(level);
      expect(log.runs[0].results[0].ruleId).toBe("ARCH-001/some-rule");
      expect(log.runs[0].results[0].message.text).toBe("bad thing");
    }
  );

  test("rule metadata is derived from the description and adr/rule id", () => {
    const summary = makeSummary({
      results: [
        {
          adrId: "ARCH-002",
          ruleId: "no-console",
          description: "No console.log allowed",
          status: "fail",
          totalViolations: 1,
          shownViolations: 1,
          violations: [
            { message: "found console.log", file: "a.ts", severity: "error" },
          ],
          durationMs: 1,
        },
      ],
    });
    const log = buildSarifLog(summary);
    expect(log.runs[0].tool.driver.rules).toHaveLength(1);
    const rule = log.runs[0].tool.driver.rules[0];
    expect(rule.id).toBe("ARCH-002/no-console");
    expect(rule.shortDescription.text).toBe("No console.log allowed");
    expect(rule.fullDescription.text).toBe("No console.log allowed");
    expect(rule.help.text).toContain("archgate adr show ARCH-002");
  });

  test("no duplicate rule ids even across multiple violations of the same rule", () => {
    const summary = makeSummary({
      results: [
        {
          adrId: "ARCH-003",
          ruleId: "no-console",
          description: "No console.log allowed",
          status: "fail",
          totalViolations: 2,
          shownViolations: 2,
          violations: [
            { message: "one", file: "a.ts", severity: "error" },
            { message: "two", file: "b.ts", severity: "error" },
          ],
          durationMs: 1,
        },
      ],
    });
    const log = buildSarifLog(summary);
    expect(log.runs[0].tool.driver.rules).toHaveLength(1);
    expect(log.runs[0].results).toHaveLength(2);
    const ids = new Set(log.runs[0].tool.driver.rules.map((r) => r.id));
    expect(ids.size).toBe(log.runs[0].tool.driver.rules.length);
  });

  test("suppressionWarnings map to a synthetic rule, always at warning level", () => {
    const summary = makeSummary({
      suppressionWarnings: [
        { message: "Unused suppression", file: "src/a.ts", line: 3 },
      ],
    });
    const log = buildSarifLog(summary);
    expect(log.runs[0].results).toHaveLength(1);
    const result = log.runs[0].results[0];
    expect(result.ruleId).toBe("archgate/suppression-warning");
    expect(result.level).toBe("warning");
    expect(result.message.text).toBe("Unused suppression");
    expect(
      log.runs[0].tool.driver.rules.find(
        (r) => r.id === "archgate/suppression-warning"
      )
    ).toBeDefined();
  });

  test("briefingWarnings map to a synthetic rule with no region (file only)", () => {
    const summary = makeSummary({
      briefingWarnings: [
        {
          adrId: "ARCH-004",
          file: ".archgate/adrs/ARCH-004-foo.md",
          section: "Decision",
          length: 2500,
          cap: 2000,
        },
      ],
    });
    const log = buildSarifLog(summary);
    expect(log.runs[0].results).toHaveLength(1);
    const result = log.runs[0].results[0];
    expect(result.ruleId).toBe("archgate/briefing-budget");
    expect(result.level).toBe("warning");
    expect(result.message.text).toContain("ARCH-004");
    expect(result.message.text).toContain("2500");
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe(
      ".archgate/adrs/ARCH-004-foo.md"
    );
    expect(result.locations[0].physicalLocation.region).toBeUndefined();
  });

  test("unparsedAdrs map to a synthetic rule with no region", () => {
    const summary = makeSummary({ unparsedAdrs: [".archgate/adrs/BROKEN.md"] });
    const log = buildSarifLog(summary);
    expect(log.runs[0].results).toHaveLength(1);
    const result = log.runs[0].results[0];
    expect(result.ruleId).toBe("archgate/unparsed-adr");
    expect(result.level).toBe("warning");
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe(
      ".archgate/adrs/BROKEN.md"
    );
    expect(result.locations[0].physicalLocation.region).toBeUndefined();
    expect(
      log.runs[0].tool.driver.rules.find(
        (r) => r.id === "archgate/unparsed-adr"
      )
    ).toBeDefined();
  });

  test("location region includes startLine/endLine when known, no columns", () => {
    const summary = makeSummary({
      results: [
        {
          adrId: "ARCH-005",
          ruleId: "rule",
          description: "d",
          status: "fail",
          totalViolations: 1,
          shownViolations: 1,
          violations: [
            {
              message: "m",
              file: "a.ts",
              line: 5,
              endLine: 7,
              endColumn: 12,
              severity: "error",
            },
          ],
          durationMs: 1,
        },
      ],
    });
    const log = buildSarifLog(summary);
    const region = log.runs[0].results[0].locations[0].physicalLocation.region;
    expect(region).toEqual({ startLine: 5, endLine: 7 });
    expect(region).not.toHaveProperty("startColumn");
    expect(region).not.toHaveProperty("endColumn");
  });

  test("violation with a file but no line omits region entirely", () => {
    const summary = makeSummary({
      results: [
        {
          adrId: "ARCH-006",
          ruleId: "rule",
          description: "d",
          status: "fail",
          totalViolations: 1,
          shownViolations: 1,
          violations: [{ message: "m", file: "a.ts", severity: "error" }],
          durationMs: 1,
        },
      ],
    });
    const log = buildSarifLog(summary);
    expect(
      log.runs[0].results[0].locations[0].physicalLocation.region
    ).toBeUndefined();
  });

  test("violation with no file at all has an empty locations array", () => {
    const summary = makeSummary({
      results: [
        {
          adrId: "ARCH-007",
          ruleId: "rule",
          description: "d",
          status: "fail",
          totalViolations: 1,
          shownViolations: 1,
          violations: [{ message: "m", severity: "error" }],
          durationMs: 1,
        },
      ],
    });
    const log = buildSarifLog(summary);
    expect(log.runs[0].results[0].locations).toEqual([]);
  });

  test("results are ordered: violations, then suppression, then briefing, then unparsed", () => {
    const summary = makeSummary({
      results: [
        {
          adrId: "ARCH-008",
          ruleId: "rule",
          description: "d",
          status: "fail",
          totalViolations: 1,
          shownViolations: 1,
          violations: [
            { message: "violation", file: "a.ts", severity: "error" },
          ],
          durationMs: 1,
        },
      ],
      suppressionWarnings: [{ message: "suppression", file: "b.ts", line: 1 }],
      briefingWarnings: [
        {
          adrId: "ARCH-009",
          file: "c.md",
          section: "Decision",
          length: 10,
          cap: 5,
        },
      ],
      unparsedAdrs: ["d.md"],
    });
    const log = buildSarifLog(summary);
    expect(log.runs[0].results.map((r) => r.ruleId)).toEqual([
      "ARCH-008/rule",
      "archgate/suppression-warning",
      "archgate/briefing-budget",
      "archgate/unparsed-adr",
    ]);
  });
});
