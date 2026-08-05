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
  reportSarif,
} from "../../src/engine/reporter";
import type { CheckResult } from "../../src/engine/runner";

/**
 * `styleText` wraps every colored fragment in escape sequences, which split
 * otherwise-contiguous output. Assertions compare the plain text.
 */
const ANSI_PATTERN = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;]*m`, "gu");

describe("reporter diagnostics rendering", () => {
  let logs: string[];
  let consoleSpy: Mock<typeof console.log>;

  function output(): string {
    return logs.join("\n").replace(ANSI_PATTERN, "");
  }

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
    overrides: Partial<CheckResult["results"][0]> = {},
    extra: Partial<CheckResult> = {}
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
      ...extra,
    };
  }

  describe("reportConsole", () => {
    test("renders a rule execution error with its message", () => {
      reportConsole(makeResult({ error: "kaboom" }), false);
      expect(output()).toContain("x TEST-001/test-rule");
      expect(output()).toContain("Rule error: kaboom");
    });

    test("lists passing rules under verbose", () => {
      reportConsole(makeResult(), true);
      expect(output()).toContain("+ TEST-001/test-rule");
    });

    test("omits passing rule lines without verbose", () => {
      reportConsole(makeResult(), false);
      expect(output()).not.toContain("+ TEST-001/test-rule");
    });

    const severityCases = [
      { severity: "error" as const, label: "[error]" },
      { severity: "warning" as const, label: "[warn]" },
      { severity: "info" as const, label: "[info]" },
    ];

    test.each(severityCases)(
      "labels a $severity violation as $label",
      ({ severity, label }) => {
        reportConsole(
          makeResult({
            violations: [
              { ruleId: "r", adrId: "a", message: "finding", severity },
            ],
          }),
          false
        );
        expect(output()).toContain(`${label} finding`);
      }
    );

    test("appends file:line when both are present", () => {
      reportConsole(
        makeResult({
          violations: [
            {
              ruleId: "r",
              adrId: "a",
              message: "located",
              file: "src/foo.ts",
              line: 5,
              severity: "error",
            },
          ],
        }),
        false
      );
      expect(output()).toContain("[error] located src/foo.ts:5");
    });

    test("appends the file alone when no line is known", () => {
      reportConsole(
        makeResult({
          violations: [
            {
              ruleId: "r",
              adrId: "a",
              message: "file only",
              file: "src/bar.ts",
              severity: "error",
            },
          ],
        }),
        false
      );
      expect(output()).toContain("[error] file only src/bar.ts");
      expect(output()).not.toContain("src/bar.ts:");
    });

    test("prints the fix hint only under verbose", () => {
      const result = makeResult({
        violations: [
          {
            ruleId: "r",
            adrId: "a",
            message: "fixable",
            severity: "error",
            fix: "Replace it",
          },
        ],
      });
      reportConsole(result, true);
      expect(output()).toContain("fix: Replace it");

      logs = [];
      reportConsole(result, false);
      expect(output()).not.toContain("fix: Replace it");
    });

    test("renders suppression warnings with and without a line number", () => {
      reportConsole(
        makeResult(
          {},
          {
            suppressedCount: 2,
            suppressionWarnings: [
              {
                message: "Suppression missing a reason",
                file: "src/a.ts",
                line: 12,
              },
              { message: "Unused suppression", file: "src/b.ts", line: 0 },
            ],
          }
        ),
        false
      );
      expect(output()).toContain(
        "[suppression] Suppression missing a reason src/a.ts:12"
      );
      expect(output()).toContain("[suppression] Unused suppression src/b.ts");
      expect(output()).toContain("2 suppressed");
    });

    test("renders briefing-budget warnings with the hidden-char count", () => {
      reportConsole(
        makeResult(
          {},
          {
            briefingWarnings: [
              {
                adrId: "ARCH-001",
                file: ".archgate/adrs/ARCH-001.md",
                section: "Decision",
                length: 2500,
                cap: 2000,
              },
            ],
          }
        ),
        false
      );
      expect(output()).toContain(
        '[briefing] ARCH-001 "Decision" is 2500 chars'
      );
      expect(output()).toContain(
        "hiding 500 from agent briefings .archgate/adrs/ARCH-001.md"
      );
    });

    test("renders unparsed ADRs as their own diagnostic line", () => {
      reportConsole(
        makeResult({}, { unparsedAdrs: [".archgate/adrs/broken.md"] }),
        false
      );
      expect(output()).toContain(
        "[adr] could not be parsed, so it was excluded from every check above .archgate/adrs/broken.md"
      );
    });

    // ARCH-026: rule-severity warnings and the advisory categories are two
    // independent strict escalations, so both trailers can appear at once.
    test("prints both strict trailers when warnings and advisories coexist", () => {
      const result = makeResult(
        {
          violations: [
            { ruleId: "r", adrId: "a", message: "meh", severity: "warning" },
          ],
        },
        { unparsedAdrs: ["broken.md"] }
      );
      const summary = buildSummary(result, { strict: true });
      reportConsole(result, false, summary);
      expect(output()).toContain("1 warning(s) are treated as failures");
      expect(output()).toContain("advisory findings above");
      expect(summary.pass).toBe(false);
    });

    test("prints a per-rule timing breakdown under verbose", () => {
      reportConsole(makeResult(), true);
      expect(output()).toContain("Timing:");
      expect(output()).toContain("TEST-001/test-rule: 10ms");
    });

    test("omits the timing breakdown without verbose", () => {
      reportConsole(makeResult(), false);
      expect(output()).not.toContain("Timing:");
    });
  });

  describe("reportCI", () => {
    test("annotates rule execution errors", () => {
      reportCI(makeResult({ error: "kaboom" }));
      expect(output()).toContain(
        "::error title=TEST-001/test-rule::Rule execution error: kaboom"
      );
    });

    test("annotates suppression warnings with and without a location", () => {
      reportCI(
        makeResult(
          {},
          {
            suppressionWarnings: [
              { message: "Missing reason", file: "src/a.ts", line: 3 },
              { message: "Unused suppression", file: "", line: 0 },
            ],
          }
        )
      );
      expect(output()).toContain(
        "::warning file=src/a.ts,line=3 title=suppression::Missing reason"
      );
      expect(output()).toContain(
        "::warning title=suppression::Unused suppression"
      );
    });

    test("annotates briefing-budget warnings", () => {
      reportCI(
        makeResult(
          {},
          {
            briefingWarnings: [
              {
                adrId: "ARCH-002",
                file: ".archgate/adrs/ARCH-002.md",
                section: "Do's and Don'ts",
                length: 3000,
                cap: 2000,
              },
            ],
          }
        )
      );
      expect(output()).toContain(
        "::warning file=.archgate/adrs/ARCH-002.md title=briefing-budget::"
      );
      expect(output()).toContain(
        "is 3000 chars; review-context truncates at 2000"
      );
    });

    test("annotates unparsed ADRs", () => {
      reportCI(makeResult({}, { unparsedAdrs: [".archgate/adrs/broken.md"] }));
      expect(output()).toContain(
        "::warning file=.archgate/adrs/broken.md title=unparsed-adr::ADR could not be parsed"
      );
    });
  });

  describe("reportSarif", () => {
    test("emits a SARIF 2.1.0 log carrying the run's violations", () => {
      reportSarif(
        makeResult({
          violations: [
            {
              ruleId: "r",
              adrId: "a",
              message: "sarif finding",
              file: "src/foo.ts",
              line: 7,
              severity: "error",
            },
          ],
        })
      );
      const log: unknown = JSON.parse(logs.join("\n"));
      expect(log).toMatchObject({
        $schema: "https://json.schemastore.org/sarif-2.1.0.json",
        version: "2.1.0",
      });
      expect(output()).toContain("sarif finding");
    });
  });
});
