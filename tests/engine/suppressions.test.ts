// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RuleResult } from "../../src/engine/runner";
import {
  parseSuppressions,
  applySuppressions,
} from "../../src/engine/suppressions";
import type { ViolationDetail } from "../../src/formats/rules";

// ---------------------------------------------------------------------------
// parseSuppressions
// ---------------------------------------------------------------------------

describe("parseSuppressions", () => {
  test("parses a next-line suppression with reason", () => {
    const content =
      '// archgate-ignore ARCH-006/no-unapproved-deps legacy dep\nimport chalk from "chalk";\n';
    const result = parseSuppressions(content, "src/foo.ts");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "next-line",
      adrId: "ARCH-006",
      ruleId: "no-unapproved-deps",
      reason: "legacy dep",
      line: 1,
      file: "src/foo.ts",
      matched: false,
    });
  });

  test("parses a file-level suppression with reason", () => {
    const content =
      "// archgate-ignore-file ARCH-005/test-mirrors-src generated file\n\nexport default {};\n";
    const result = parseSuppressions(content, "src/gen.ts");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "file",
      adrId: "ARCH-005",
      ruleId: "test-mirrors-src",
      reason: "generated file",
      line: 1,
      file: "src/gen.ts",
    });
  });

  test("parses hash-style comments", () => {
    const content =
      "# archgate-ignore GEN-003/scripts-only Makefile target\nfoo: bar\n";
    const result = parseSuppressions(content, "Makefile");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "next-line",
      adrId: "GEN-003",
      ruleId: "scripts-only",
      reason: "Makefile target",
    });
  });

  test("records null reason when reason text is missing", () => {
    const content =
      "// archgate-ignore ARCH-006/no-unapproved-deps\nimport chalk;\n";
    const result = parseSuppressions(content, "src/foo.ts");

    expect(result).toHaveLength(1);
    expect(result[0].reason).toBeNull();
  });

  test("parses multiple suppression comments in one file", () => {
    const content = [
      "// archgate-ignore ARCH-001/cmd-export legacy",
      'import { foo } from "./bar";',
      "// archgate-ignore ARCH-002/no-console debug helper",
      "console.log(foo);",
    ].join("\n");
    const result = parseSuppressions(content, "src/main.ts");

    expect(result).toHaveLength(2);
    expect(result[0].adrId).toBe("ARCH-001");
    expect(result[0].line).toBe(1);
    expect(result[1].adrId).toBe("ARCH-002");
    expect(result[1].line).toBe(3);
  });

  test("ignores non-matching lines", () => {
    const content = [
      "// This is a normal comment",
      "const x = 1; // archgate-ignore is not at line start",
      "/* archgate-ignore ARCH-001/foo -- block comments not supported */",
      "// archgate-ignoreFOO ARCH-001/foo -- no space",
    ].join("\n");
    const result = parseSuppressions(content, "src/foo.ts");

    expect(result).toHaveLength(0);
  });

  test("handles leading whitespace before comment marker", () => {
    const content =
      "  // archgate-ignore ARCH-006/no-deps indented\n  import x;\n";
    const result = parseSuppressions(content, "src/foo.ts");

    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("indented");
  });

  test("handles ADR IDs with numbers and hyphens", () => {
    const content =
      "// archgate-ignore CI-001/pin-sha exempted\nuses: actions/checkout@v4\n";
    const result = parseSuppressions(content, ".github/workflows/ci.yml");

    expect(result).toHaveLength(1);
    expect(result[0].adrId).toBe("CI-001");
    expect(result[0].ruleId).toBe("pin-sha");
  });

  test("returns empty array for empty content", () => {
    expect(parseSuppressions("", "empty.ts")).toHaveLength(0);
  });

  test("skips suppression comments inside markdown code blocks", () => {
    const content = [
      "# Example",
      "",
      "```typescript",
      "// archgate-ignore ARCH-006/no-unapproved-deps example in docs",
      'import chalk from "chalk";',
      "```",
      "",
      "Real suppression outside code block:",
      "// archgate-ignore ARCH-001/cmd-export real one",
      "some code",
    ].join("\n");
    const result = parseSuppressions(content, "docs/guide.mdx");

    expect(result).toHaveLength(1);
    expect(result[0].adrId).toBe("ARCH-001");
    expect(result[0].ruleId).toBe("cmd-export");
  });

  test("stacked suppressions share the same targetLine", () => {
    const content = [
      "// archgate-ignore ARCH-006/no-unapproved-deps legacy dep",
      "// archgate-ignore ARCH-002/no-console debug helper",
      "// archgate-ignore ARCH-003/use-style-text third-party lib",
      "// archgate-ignore ARCH-004/no-barrel barrel needed here",
      'console.log(chalk.red("error"));',
    ].join("\n");
    const result = parseSuppressions(content, "src/foo.ts");

    expect(result).toHaveLength(4);
    // All four target line 5 (the first non-suppression line)
    expect(result[0].targetLine).toBe(5);
    expect(result[1].targetLine).toBe(5);
    expect(result[2].targetLine).toBe(5);
    expect(result[3].targetLine).toBe(5);
  });

  test("single suppression targets the next line", () => {
    const content = [
      "// archgate-ignore ARCH-006/no-unapproved-deps legacy dep",
      'import chalk from "chalk";',
    ].join("\n");
    const result = parseSuppressions(content, "src/foo.ts");

    expect(result).toHaveLength(1);
    expect(result[0].targetLine).toBe(2);
  });

  test("does not skip code blocks in non-markdown files", () => {
    const content = [
      "```",
      "// archgate-ignore ARCH-001/foo inside backticks in .ts",
      "```",
    ].join("\n");
    const result = parseSuppressions(content, "src/foo.ts");

    // In a .ts file, ``` is not a code fence — the comment should be parsed
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// applySuppressions
// ---------------------------------------------------------------------------

describe("applySuppressions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "archgate-suppress-")));
    mkdirSync(join(tempDir, "src"), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* temp dir cleanup may fail on Windows */
    }
  });

  function makeViolation(
    overrides: Partial<ViolationDetail> = {}
  ): ViolationDetail {
    return {
      ruleId: "no-console",
      adrId: "ARCH-002",
      message: "Found console.log",
      file: "src/foo.ts",
      line: 2,
      severity: "error",
      ...overrides,
    };
  }

  function makeRuleResult(violations: ViolationDetail[]): RuleResult {
    return {
      ruleId: violations[0]?.ruleId ?? "test-rule",
      adrId: violations[0]?.adrId ?? "TEST-001",
      description: "Test rule",
      violations,
      durationMs: 10,
    };
  }

  test("suppresses next-line violation with matching comment", async () => {
    writeFileSync(
      join(tempDir, "src", "foo.ts"),
      [
        "// archgate-ignore ARCH-002/no-console debug helper",
        'console.log("hello");',
        "",
      ].join("\n")
    );

    const v = makeViolation({ file: "src/foo.ts", line: 2 });
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    expect(result.suppressedCount).toBe(1);
    expect(result.activeViolations.has(v)).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  test("stacked suppressions suppress multiple rules on same line", async () => {
    writeFileSync(
      join(tempDir, "src", "foo.ts"),
      [
        "// archgate-ignore ARCH-006/no-deps legacy dep",
        "// archgate-ignore ARCH-002/no-console debug helper",
        'console.log(chalk.red("error"));',
        "",
      ].join("\n")
    );

    const v1 = makeViolation({
      file: "src/foo.ts",
      line: 3,
      adrId: "ARCH-006",
      ruleId: "no-deps",
    });
    const v2 = makeViolation({
      file: "src/foo.ts",
      line: 3,
      adrId: "ARCH-002",
      ruleId: "no-console",
    });
    const result = await applySuppressions(tempDir, [
      makeRuleResult([v1]),
      makeRuleResult([v2]),
    ]);

    expect(result.suppressedCount).toBe(2);
    expect(result.activeViolations.has(v1)).toBe(false);
    expect(result.activeViolations.has(v2)).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  test("does not suppress when comment is not on preceding line", async () => {
    writeFileSync(
      join(tempDir, "src", "foo.ts"),
      [
        "// archgate-ignore ARCH-002/no-console debug helper",
        "const x = 1;",
        'console.log("hello");',
        "",
      ].join("\n")
    );

    const v = makeViolation({ file: "src/foo.ts", line: 3 });
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    expect(result.suppressedCount).toBe(0);
    expect(result.activeViolations.has(v)).toBe(true);
  });

  test("file-level suppression suppresses all matching violations", async () => {
    writeFileSync(
      join(tempDir, "src", "foo.ts"),
      [
        "// archgate-ignore-file ARCH-002/no-console entire file exempt",
        'console.log("a");',
        'console.log("b");',
        "",
      ].join("\n")
    );

    const v1 = makeViolation({ file: "src/foo.ts", line: 2 });
    const v2 = makeViolation({ file: "src/foo.ts", line: 3 });
    const result = await applySuppressions(tempDir, [makeRuleResult([v1, v2])]);

    expect(result.suppressedCount).toBe(2);
    expect(result.activeViolations.has(v1)).toBe(false);
    expect(result.activeViolations.has(v2)).toBe(false);
  });

  test("missing reason leaves violation active and emits warning", async () => {
    writeFileSync(
      join(tempDir, "src", "foo.ts"),
      [
        "// archgate-ignore ARCH-002/no-console",
        'console.log("hello");',
        "",
      ].join("\n")
    );

    const v = makeViolation({ file: "src/foo.ts", line: 2 });
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    expect(result.suppressedCount).toBe(0);
    expect(result.activeViolations.has(v)).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain("missing a reason");
  });

  test("violations without file pass through unsuppressed", async () => {
    const v = makeViolation({ file: undefined, line: undefined });
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    expect(result.suppressedCount).toBe(0);
    expect(result.activeViolations.has(v)).toBe(true);
  });

  test("violations without line pass through unsuppressed", async () => {
    writeFileSync(
      join(tempDir, "src", "foo.ts"),
      [
        "// archgate-ignore ARCH-002/no-console debug",
        'console.log("hello");',
        "",
      ].join("\n")
    );

    const v = makeViolation({ file: "src/foo.ts", line: undefined });
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    expect(result.suppressedCount).toBe(0);
    expect(result.activeViolations.has(v)).toBe(true);
  });

  test("file-level suppresses violations without line number", async () => {
    writeFileSync(
      join(tempDir, "src", "foo.ts"),
      [
        "// archgate-ignore-file ARCH-002/no-console exempt",
        'console.log("hello");',
        "",
      ].join("\n")
    );

    const v = makeViolation({ file: "src/foo.ts", line: undefined });
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    expect(result.suppressedCount).toBe(1);
    expect(result.activeViolations.has(v)).toBe(false);
  });

  test("mismatched adrId/ruleId does not suppress", async () => {
    writeFileSync(
      join(tempDir, "src", "foo.ts"),
      [
        "// archgate-ignore ARCH-006/no-deps wrong rule",
        'console.log("hello");',
        "",
      ].join("\n")
    );

    const v = makeViolation({
      file: "src/foo.ts",
      line: 2,
      adrId: "ARCH-002",
      ruleId: "no-console",
    });
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    expect(result.suppressedCount).toBe(0);
    expect(result.activeViolations.has(v)).toBe(true);
  });

  test("reports unused suppression warning", async () => {
    // Suppression targets ARCH-002/no-console on line 1 (next-line = line 2),
    // but the violation is on line 3 — so the suppression is unused.
    writeFileSync(
      join(tempDir, "src", "foo.ts"),
      [
        "// archgate-ignore ARCH-002/no-console debug helper",
        "const x = 1;",
        'console.log("hello");',
        "",
      ].join("\n")
    );

    const v = makeViolation({ file: "src/foo.ts", line: 3 });
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    const unusedWarnings = result.warnings.filter((w) =>
      w.message.includes("Unused suppression")
    );
    expect(unusedWarnings).toHaveLength(1);
    expect(unusedWarnings[0].file).toBe("src/foo.ts");
  });

  test("handles file read failure gracefully", async () => {
    // Violation references a file that doesn't exist
    const v = makeViolation({ file: "src/nonexistent.ts", line: 2 });
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    expect(result.suppressedCount).toBe(0);
    expect(result.activeViolations.has(v)).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  test("returns all violations active when no suppressions exist", async () => {
    writeFileSync(join(tempDir, "src", "foo.ts"), 'console.log("hello");\n');

    const v = makeViolation({ file: "src/foo.ts", line: 1 });
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    expect(result.suppressedCount).toBe(0);
    expect(result.activeViolations.has(v)).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  test("handles multiple rule results across different files", async () => {
    writeFileSync(
      join(tempDir, "src", "a.ts"),
      [
        "// archgate-ignore ARCH-002/no-console ok in a",
        'console.log("a");',
        "",
      ].join("\n")
    );
    writeFileSync(join(tempDir, "src", "b.ts"), 'console.log("b");\n');

    const v1 = makeViolation({ file: "src/a.ts", line: 2 });
    const v2 = makeViolation({ file: "src/b.ts", line: 1 });
    const result = await applySuppressions(tempDir, [
      makeRuleResult([v1]),
      makeRuleResult([v2]),
    ]);

    expect(result.suppressedCount).toBe(1);
    expect(result.activeViolations.has(v1)).toBe(false);
    expect(result.activeViolations.has(v2)).toBe(true);
  });

  test("returns early with no work when violations have no file paths", async () => {
    const v = makeViolation({ file: undefined });
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    expect(result.suppressedCount).toBe(0);
    expect(result.activeViolations.size).toBe(1);
  });
});
