import { describe, expect, test } from "bun:test";

import { scanRuleSource } from "../../src/engine/rule-scanner";

/**
 * Adversarial tests for the security scanner's position remapping.
 *
 * These test cases cover scenarios where banned patterns appear in
 * comments or string literals before the actual code violation,
 * which could cause the string-search remapping to point to the
 * wrong location.
 */
describe("scanRuleSource adversarial position mapping", () => {
  test("pattern in line comment before code violation", () => {
    const source = [
      "// WARNING: Do not use Bun.spawn in rule files",
      "// Use the RuleContext API instead",
      "",
      "export default {",
      "  rules: {",
      '    "r": {',
      '      description: "d",',
      "      async check(ctx) {",
      "        Bun.spawn([]);",
      "      },",
      "    },",
      "  },",
      "};",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(9);
    expect(violations[0].column).toBe(8);
  });

  test("pattern in block comment before code violation", () => {
    const source = [
      "/*",
      " * Bun.spawn is dangerous and should not be used.",
      " * Use ctx.readFile() instead.",
      " */",
      "Bun.spawn([]);",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(5);
    expect(violations[0].column).toBe(0);
  });

  test("pattern in string literal before code violation", () => {
    const source = [
      'const msg = "Bun.spawn is blocked";',
      "Bun.spawn([]);",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
    expect(violations[0].column).toBe(0);
  });

  test("pattern in template literal before code violation", () => {
    const source = [
      "const msg = `Do not call Bun.spawn here`;",
      "Bun.spawn([]);",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
    expect(violations[0].column).toBe(0);
  });

  test("pattern in single-quoted string before code violation", () => {
    const source = [
      "const msg = 'Bun.file is blocked';",
      "Bun.file('/etc/passwd');",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
  });

  test("multiple patterns in comments before code violations", () => {
    const source = [
      "// Bun.spawn - blocked",
      "// Bun.file - also blocked",
      "// fetch - blocked too",
      "",
      "Bun.spawn([]);",
      "Bun.file('/etc/passwd');",
      "fetch('https://evil.com');",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(3);
    expect(violations[0].line).toBe(5);
    expect(violations[0].message).toContain("Bun.spawn()");
    expect(violations[1].line).toBe(6);
    expect(violations[1].message).toContain("Bun.file()");
    expect(violations[2].line).toBe(7);
    expect(violations[2].message).toContain("fetch()");
  });

  test("eval in comment then eval in code", () => {
    const source = [
      "// eval() is dangerous, don't use it",
      'const x = "eval is bad";',
      "eval('malicious');",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(3);
    expect(violations[0].column).toBe(0);
  });

  test("import module name in comment before banned import", () => {
    const source = [
      '// Do not import from "node:fs"',
      'import { readFileSync } from "node:fs";',
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
  });

  test("import module name in string before banned import", () => {
    const source = [
      'const blocked = "node:fs";',
      'import { readFileSync } from "node:fs";',
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
  });

  test("fetch in string literal is not confused with fetch call", () => {
    const source = [
      'const msg = "fetch data from server";',
      "const url = 'use fetch API';",
      "fetch('https://evil.com');",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(3);
  });

  test("Bun.spawn in error message string then actual violation", () => {
    // Realistic case: rule file logging what it found
    const source = [
      "export default {",
      "  rules: {",
      '    "r": {',
      '      description: "d",',
      "      async check(ctx) {",
      "        ctx.report.violation({",
      '          message: "Found Bun.spawn usage",',
      "        });",
      "        Bun.spawn([]);",
      "      },",
      "    },",
      "  },",
      "};",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(9);
    expect(violations[0].column).toBe(8);
  });

  test("pattern repeated in both comment and code multiple times", () => {
    const source = [
      "// Bun.spawn once",
      "Bun.spawn([]);",
      "// Bun.spawn again",
      "Bun.spawn([]);",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(2);
    expect(violations[0].line).toBe(2);
    expect(violations[1].line).toBe(4);
  });

  test("inline comment after violation on same line", () => {
    const source = "Bun.spawn([]); // this is bad";
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(1);
    expect(violations[0].column).toBe(0);
  });

  test("globalThis in comment before globalThis mutation", () => {
    const source = [
      "// Don't mutate globalThis.anything",
      "globalThis.myGlobal = 42;",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
  });

  test("computed access pattern in string before actual violation", () => {
    const source = [
      'const x = "Bun[method] is blocked";',
      'const method = "spawn";',
      "Bun[method]();",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(3);
  });

  test("minified code on single line reports correct column", () => {
    const source = 'const a=1;const b=2;Bun.spawn([]);const c=3;';
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(1);
    expect(violations[0].column).toBe(20);
  });

  test("multiple violations on same line", () => {
    const source = "Bun.spawn([]);Bun.file('/x');";
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(2);
    expect(violations[0].line).toBe(1);
    expect(violations[0].column).toBe(0);
    expect(violations[1].line).toBe(1);
    expect(violations[1].column).toBe(14);
  });

  test("escaped quotes in string don't break non-code detection", () => {
    const source = [
      'const x = "he said \\"Bun.spawn\\" is bad";',
      "Bun.spawn([]);",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
  });
});
