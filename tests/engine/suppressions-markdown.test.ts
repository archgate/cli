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
// HTML-comment suppressions — the only form that stays invisible in rendered
// markdown, where `#` becomes a heading and `//` becomes body text.
// ---------------------------------------------------------------------------

describe("parseSuppressions (markdown HTML comments)", () => {
  test("parses a next-line suppression with reason", () => {
    const content = [
      "Some prose.",
      "<!-- archgate-ignore ARCH-021/no-escaped-backtick escaped on purpose -->",
      "A line with an escaped backtick.",
    ].join("\n");
    const result = parseSuppressions(content, "docs/guide.md");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "next-line",
      adrId: "ARCH-021",
      ruleId: "no-escaped-backtick",
      reason: "escaped on purpose",
      line: 2,
      targetLine: 3,
      file: "docs/guide.md",
      matched: false,
    });
  });

  test("records null reason when reason text is missing", () => {
    const content =
      "<!-- archgate-ignore ARCH-021/no-escaped-backtick -->\ntext\n";
    const result = parseSuppressions(content, "docs/guide.md");

    expect(result).toHaveLength(1);
    expect(result[0].reason).toBeNull();
    expect(result[0].ruleId).toBe("no-escaped-backtick");
  });

  test("treats a whitespace-only reason as missing", () => {
    const content = [
      "<!-- archgate-ignore ARCH-021/no-escaped-backtick    -->",
      "text",
    ].join("\n");
    const result = parseSuppressions(content, "docs/guide.md");

    expect(result).toHaveLength(1);
    expect(result[0].reason).toBeNull();
  });

  test("parses the file-level variant", () => {
    const content = [
      "<!-- archgate-ignore-file ARCH-021/ai-writing-signs quoted source text -->",
      "",
      "# Title",
    ].join("\n");
    const result = parseSuppressions(content, "docs/guide.mdx");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "file",
      adrId: "ARCH-021",
      ruleId: "ai-writing-signs",
      reason: "quoted source text",
      line: 1,
    });
    expect(result[0].targetLine).toBeUndefined();
  });

  test("tolerates leading and trailing whitespace around the comment", () => {
    const content =
      "  <!--archgate-ignore ARCH-021/no-escaped-backtick tight form-->  \ntext\n";
    const result = parseSuppressions(content, "docs/guide.md");

    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("tight form");
  });

  test("skips directives inside fenced code blocks", () => {
    const content = [
      "```md",
      "<!-- archgate-ignore ARCH-021/no-escaped-backtick example in docs -->",
      "```",
      "",
      "<!-- archgate-ignore ARCH-001/cmd-export real one -->",
      "prose",
    ].join("\n");
    const result = parseSuppressions(content, "docs/guide.md");

    expect(result).toHaveLength(1);
    expect(result[0].adrId).toBe("ARCH-001");
    expect(result[0].ruleId).toBe("cmd-export");
  });

  test("ignores the HTML form in non-markdown files", () => {
    const content =
      "<!-- archgate-ignore ARCH-001/cmd-export not markdown -->\n<div />\n";
    const result = parseSuppressions(content, "src/page.html");

    expect(result).toHaveLength(0);
  });

  test.each([
    [
      "trailing content before the comment",
      "text <!-- archgate-ignore A/b x -->",
    ],
    ["unterminated comment", "<!-- archgate-ignore ARCH-001/cmd-export x"],
    [
      "content after the comment",
      "<!-- archgate-ignore ARCH-001/cmd-export --> x",
    ],
  ])("ignores a comment that is not the whole line: %s", (_label, line) => {
    expect(parseSuppressions(line, "docs/guide.md")).toHaveLength(0);
  });

  test("stacks like the comment-marker forms", () => {
    const content = [
      "<!-- archgate-ignore ARCH-021/no-escaped-backtick backtick is literal -->",
      "<!-- archgate-ignore ARCH-021/ai-writing-signs quoted verbatim -->",
      "The line both rules flag.",
    ].join("\n");
    const result = parseSuppressions(content, "docs/guide.md");

    expect(result).toHaveLength(2);
    expect(result[0].targetLine).toBe(3);
    expect(result[1].targetLine).toBe(3);
  });

  test("comment-marker forms still parse in markdown", () => {
    const content = [
      "# archgate-ignore GEN-004/concise-comments hash form",
      "prose",
      "// archgate-ignore ARCH-001/cmd-export slash form",
      "more prose",
    ].join("\n");
    const result = parseSuppressions(content, "docs/guide.md");

    expect(result).toHaveLength(2);
    expect(result[0].adrId).toBe("GEN-004");
    expect(result[1].adrId).toBe("ARCH-001");
  });
});

describe("applySuppressions (markdown HTML comments)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = realpathSync(
      mkdtempSync(join(tmpdir(), "archgate-suppress-md-"))
    );
    mkdirSync(join(tempDir, "docs"), { recursive: true });
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
      ruleId: "no-escaped-backtick",
      adrId: "ARCH-021",
      message: "Escaped backtick in markdown",
      file: "docs/guide.md",
      line: 3,
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

  test("suppresses the violation on the following line", async () => {
    writeFileSync(
      join(tempDir, "docs", "guide.md"),
      [
        "# Guide",
        "<!-- archgate-ignore ARCH-021/no-escaped-backtick literal backtick -->",
        "An escaped backtick line.",
        "",
      ].join("\n")
    );

    const v = makeViolation();
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    expect(result.suppressedCount).toBe(1);
    expect(result.activeViolations.has(v)).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  test("file-level form suppresses every matching violation", async () => {
    writeFileSync(
      join(tempDir, "docs", "guide.md"),
      [
        "<!-- archgate-ignore-file ARCH-021/no-escaped-backtick shell transcript -->",
        "First escaped backtick.",
        "Second escaped backtick.",
        "",
      ].join("\n")
    );

    const v1 = makeViolation({ line: 2 });
    const v2 = makeViolation({ line: 3 });
    const result = await applySuppressions(tempDir, [makeRuleResult([v1, v2])]);

    expect(result.suppressedCount).toBe(2);
    expect(result.activeViolations.size).toBe(0);
  });

  test("missing reason leaves the violation active and warns", async () => {
    writeFileSync(
      join(tempDir, "docs", "guide.md"),
      [
        "# Guide",
        "<!-- archgate-ignore ARCH-021/no-escaped-backtick -->",
        "An escaped backtick line.",
        "",
      ].join("\n")
    );

    const v = makeViolation();
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    expect(result.suppressedCount).toBe(0);
    expect(result.activeViolations.has(v)).toBe(true);
    expect(result.warnings[0].message).toContain("missing a reason");
  });

  test("whitespace-only reason leaves the violation active and warns", async () => {
    writeFileSync(
      join(tempDir, "docs", "guide.md"),
      [
        "# Guide",
        "<!-- archgate-ignore ARCH-021/no-escaped-backtick    -->",
        "An escaped backtick line.",
        "",
      ].join("\n")
    );

    const v = makeViolation();
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    expect(result.suppressedCount).toBe(0);
    expect(result.activeViolations.has(v)).toBe(true);
    expect(result.warnings[0].message).toContain("missing a reason");
  });

  test("unused suppression warns", async () => {
    writeFileSync(
      join(tempDir, "docs", "guide.md"),
      [
        "<!-- archgate-ignore ARCH-021/no-escaped-backtick literal backtick -->",
        "A clean line.",
        "An escaped backtick line.",
        "",
      ].join("\n")
    );

    const v = makeViolation({ line: 3 });
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    expect(result.activeViolations.has(v)).toBe(true);
    expect(
      result.warnings.filter((w) => w.message.includes("Unused suppression"))
    ).toHaveLength(1);
  });
});
