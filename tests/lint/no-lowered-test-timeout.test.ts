// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import plugin, {
  GLOBAL_TEST_TIMEOUT_MS,
} from "../../lint/no-lowered-test-timeout";
import { parseJsModule } from "../../src/engine/js-parser";

/** Minimal ESTree-ish node shape, matching the plugin's own definition. */
type AstNode = { type: string } & Record<string, unknown>;

interface ReportedViolation {
  message: string;
}

/**
 * Run the `test-timeout/no-lowered-test-timeout` rule against a source
 * snippet and return every reported violation. Parses via the same
 * in-process `meriyah` entry point (`parseJsModule`, ARCH-022) the engine
 * itself uses, rather than hand-authoring AST fixtures.
 */
function lint(source: string): ReportedViolation[] {
  // meriyah's Program type structurally satisfies the plugin's own loose
  // AstNode shape (every node has a string `type` plus arbitrary fields);
  // the plugin doesn't export a type to convert through instead.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const program = parseJsModule(source) as unknown as AstNode;
  const violations: ReportedViolation[] = [];
  const rule = plugin.rules["no-lowered-test-timeout"];
  const visitor = rule.create({
    report({ message }) {
      violations.push({ message });
    },
  });
  visitor.Program(program);
  return violations;
}

describe("no-lowered-test-timeout", () => {
  test("matches the --timeout every package.json test script passes", async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const pkg = (await Bun.file(
      join(import.meta.dir, "..", "..", "package.json")
    ).json()) as { scripts: Record<string, string> };
    const testScripts = Object.entries(pkg.scripts).filter(([name]) =>
      name.startsWith("test")
    );
    expect(testScripts).not.toHaveLength(0);
    for (const [, script] of testScripts) {
      expect(script).toContain(`--timeout ${GLOBAL_TEST_TIMEOUT_MS}`);
    }
  });

  test("names the value, the global, and the ADR in the message", () => {
    const violations = lint(`test("x", () => {}, 5000);`);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("5000ms");
    expect(violations[0]?.message).toContain("60000ms global");
    expect(violations[0]?.message).toContain("ARCH-005");
  });

  test.each([
    {
      name: "a numeric literal below the global",
      source: `test("x", () => {}, 30_000);`,
      expectedLength: 1,
    },
    {
      name: "an `it` call",
      source: `it("x", () => {}, 1000);`,
      expectedLength: 1,
    },
    {
      name: "the outer call of test.skipIf(cond)(...)",
      source: `test.skipIf(process.platform === "win32")("x", () => {}, 5000);`,
      expectedLength: 1,
    },
    {
      name: "the outer call of test.each(rows)(...)",
      source: `test.each([1, 2])("x %i", () => {}, 5000);`,
      expectedLength: 1,
    },
    {
      name: "a `timeout` option in the options object",
      source: `test("x", () => {}, { timeout: 5000 });`,
      expectedLength: 1,
    },
    {
      name: "a constant declared in the same file",
      source: `
        const BUDGET_MS = 2500;
        test("x", () => {}, BUDGET_MS);
      `,
      expectedLength: 1,
    },
    {
      name: "a product of a constant and a literal",
      source: `
        const BUDGET_MS = 2500;
        test("x", () => {}, BUDGET_MS * 5);
      `,
      expectedLength: 1,
    },
    {
      name: "a constant derived from another constant",
      source: `
        const BASE_MS = 1000;
        const BUDGET_MS = BASE_MS * 4;
        test("x", () => {}, BUDGET_MS + 500);
      `,
      expectedLength: 1,
    },
    {
      name: "a skipped test carrying a lowered timeout",
      source: `test.skip("x", () => {}, 5000);`,
      expectedLength: 1,
    },
    {
      name: "a timeout equal to the global",
      source: `test("x", () => {}, 60_000);`,
      expectedLength: 0,
    },
    {
      name: "a timeout above the global",
      source: `test("x", () => {}, 120_000);`,
      expectedLength: 0,
    },
    {
      name: "a `timeout` option above the global",
      source: `test("x", () => {}, { timeout: 90_000 });`,
      expectedLength: 0,
    },
    {
      name: "an options object without `timeout`",
      source: `test("x", () => {}, { retry: 3 });`,
      expectedLength: 0,
    },
    {
      name: "a test with no third argument",
      source: `test("x", () => {});`,
      expectedLength: 0,
    },
    {
      name: "a `let` binding, which may be reassigned",
      source: `
        let budget = 5000;
        test("x", () => {}, budget);
      `,
      expectedLength: 0,
    },
    {
      name: "a value that does not fold to a number",
      source: `test("x", () => {}, computeBudget());`,
      expectedLength: 0,
    },
    {
      name: "a non-test call with a small third argument",
      source: `setTimeout(() => {}, 5000, 5000); expect(a).toBeCloseTo(1, 2);`,
      expectedLength: 0,
    },
    {
      name: "describe, which takes no timeout",
      source: `describe("suite", () => {}, 5000);`,
      expectedLength: 0,
    },
  ])("$name", ({ source, expectedLength }) => {
    expect(lint(source)).toHaveLength(expectedLength);
  });
});
