// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Sandbox-escape regression tests for the `.rules.ts` security scanner.
 *
 * `archgate check` imports and executes every companion `.rules.ts` in-process,
 * so `scanRuleSource()` is the only thing standing between a rule file and
 * arbitrary code execution on the machine running the check. ARCH-022 depends
 * on that boundary holding: it states a rule author "MUST NEVER be able to
 * reach `Bun.spawn`, `child_process`, or any other subprocess/filesystem
 * primitive directly."
 *
 * Every case here is a way that boundary was, or could be, walked around.
 * They are grouped in their own file so the list reads as one attack surface.
 */
import { describe, expect, test } from "bun:test";

import { scanRuleSource } from "../../src/engine/rule-scanner";

describe("rule sandbox escapes", () => {
  // Regression: the ImportExpression case rejected only *non-literal*
  // arguments, so a constant specifier skipped the module ban that
  // ImportDeclaration enforced. `await import("node:child_process")` executed
  // at import time and `check` still reported the ADR as passing.
  describe("dynamic import with a literal specifier", () => {
    for (const mod of [
      "node:child_process",
      "child_process",
      "node:fs",
      "bun",
    ]) {
      test(`blocks dynamic import of ${mod}`, () => {
        const violations = scanRuleSource(`const m = await import("${mod}");`);
        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain(`"${mod}"`);
        expect(violations[0].message).toContain("blocked");
      });
    }

    test("reports the line of a blocked dynamic import", () => {
      const violations = scanRuleSource(
        `const a = 1;\nconst cp = await import("node:child_process");`
      );
      expect(violations).toHaveLength(1);
      expect(violations[0].line).toBe(2);
    });
  });

  // A module does not have to be a known-dangerous builtin to be arbitrary
  // code. Each of these reaches executable code the scanner never sees,
  // without naming a banned builtin at all — which is why the module check is
  // an allowlist rather than a denylist.
  describe("modules that are not banned builtins", () => {
    const escapes: Array<[string, string]> = [
      ["relative path to an unscanned file", `import { x } from "./evil.ts";`],
      ["dynamic relative path", `const m = await import("./evil.ts");`],
      [
        "data: URL",
        `const m = await import("data:text/javascript,export default 1");`,
      ],
      ["bare npm package", `import x from "some-npm-pkg";`],
      [
        "node:module createRequire",
        `import { createRequire } from "node:module";`,
      ],
      ["re-export star", `export * from "node:child_process";`],
      ["re-export named", `export { spawn } from "node:child_process";`],
    ];

    for (const [label, source] of escapes) {
      test(`blocks ${label}`, () => {
        expect(scanRuleSource(source).length).toBeGreaterThan(0);
      });
    }

    // `path` resolves to a node_modules package if the target project ships
    // one, handing execution back to the untrusted code this scanner contains;
    // `node:path` cannot be shadowed.
    test("blocks shadowable bare 'path' while allowing node:path", () => {
      expect(scanRuleSource(`import { basename } from "path";`)).toHaveLength(
        1
      );
      expect(
        scanRuleSource(`import { basename } from "node:path";`)
      ).toHaveLength(0);
    });
  });

  describe("require and process internals", () => {
    test("blocks require()", () => {
      const violations = scanRuleSource(
        `const cp = require("node:child_process");`
      );
      expect(
        violations.filter((v) => v.message.includes("require()"))
      ).toHaveLength(1);
    });

    test("blocks import.meta.require()", () => {
      const violations = scanRuleSource(
        `const cp = import.meta.require("node:child_process");`
      );
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].message).toContain("import.meta.require()");
    });

    // process.binding / dlopen reach spawn and native code without importing
    // anything. Matched on the property name, so an aliased receiver such as
    // `globalThis.process` cannot spell around the check.
    test("blocks process.binding()", () => {
      const violations = scanRuleSource(
        `const cp = process.binding("spawn_sync");`
      );
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain(".binding()");
    });

    test("blocks globalThis.process.binding()", () => {
      expect(
        scanRuleSource(`const cp = globalThis.process.binding("spawn_sync");`)
          .length
      ).toBeGreaterThan(0);
    });

    test("blocks process.dlopen()", () => {
      expect(
        scanRuleSource(`process.dlopen(m, "evil.node");`).length
      ).toBeGreaterThan(0);
    });
  });

  // The allowlist must not swallow the ordinary shapes real rule files use.
  describe("legitimate rule files still pass", () => {
    test("allows a plain local export", () => {
      expect(scanRuleSource(`const x = 1;\nexport { x };`)).toHaveLength(0);
    });

    test("allows type-only imports (erased before scanning)", () => {
      expect(
        scanRuleSource(`import type { Foo } from "./foo";\nconst x: Foo = 1;`)
      ).toHaveLength(0);
    });

    test("allows every allowlisted module together", () => {
      const source = `
        import { basename } from "node:path";
        import { pathToFileURL } from "node:url";
        import { format } from "node:util";
        import { createHash } from "node:crypto";
        export default { rules: {} };
      `;
      expect(scanRuleSource(source)).toHaveLength(0);
    });
  });
  // Property access has two spellings, and a receiver can be aliased. Matching
  // `prop.name` on an object named `process` sees only `process.binding(...)`;
  // these are the same capability wearing different clothes.
  describe("computed access and aliased receivers", () => {
    const spellings: Array<[string, string]> = [
      ["computed literal key", `const cp = process["binding"]("spawn_sync");`],
      [
        "aliased receiver, dotted",
        `const p = process;
p.dlopen(m, "e.node");`,
      ],
      [
        "aliased receiver, computed",
        `const p = process;
p["binding"]("spawn_sync");`,
      ],
      [
        "alias chain through globalThis",
        `const g = globalThis;
const p = g["process"];
p["binding"]("spawn_sync");`,
      ],
    ];

    for (const [label, source] of spellings) {
      test(`blocks ${label}`, () => {
        expect(scanRuleSource(source).length).toBeGreaterThan(0);
      });
    }

    test("still allows ordinary computed access on a plain object", () => {
      expect(
        scanRuleSource(`const o = { a: 1 };
const k = "a";
const v = o[k];`)
      ).toHaveLength(0);
    });
  });

  // The raw-text pass. These are the only cases the AST cannot report: the
  // parser sees the true program, so a hidden character is invisible to it by
  // design. The reader of the diff is the target, not the parser.
  describe("invisible and bidi characters", () => {
    const RLO = String.fromCodePoint(0x202e);
    const ZWSP = String.fromCodePoint(0x200b);
    const BOM = String.fromCodePoint(0xfeff);

    test("blocks a bidi override hidden in a comment", () => {
      const violations = scanRuleSource(`/* ${RLO} */ const x = 1;`);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("U+202E");
      expect(violations[0].message).toContain("RIGHT-TO-LEFT OVERRIDE");
    });

    test("blocks a zero-width space inside an identifier", () => {
      expect(scanRuleSource(`const a${ZWSP}b = 1;`).length).toBeGreaterThan(0);
    });

    test("reports the true line and column of the character", () => {
      const violations = scanRuleSource(`const a = 1;
const b = 2${RLO};`);
      expect(violations[0].line).toBe(2);
      expect(violations[0].column).toBe(11);
    });

    // A BOM at offset 0 is an encoding artifact, not concealment.
    test("tolerates a leading BOM but blocks one mid-file", () => {
      expect(
        scanRuleSource(`${BOM}import { basename } from "node:path";`)
      ).toHaveLength(0);
      expect(scanRuleSource(`const a = 1;${BOM}`).length).toBeGreaterThan(0);
    });

    test("reports a hidden character even when the file does not parse", () => {
      const violations = scanRuleSource(`const ${RLO} = ;;;`);
      expect(violations.some((v) => v.message.includes("U+202E"))).toBe(true);
    });

    // Visible non-ASCII is ordinary prose in this codebase and must not trip.
    test("allows visible non-ASCII in messages", () => {
      expect(
        scanRuleSource(`ctx.report.violation({ message: "bad — fix it" });`)
      ).toHaveLength(0);
    });
  });

  // The AST resolves escapes, so it de-obfuscates for free. This is why the
  // text pass deliberately does NOT search for dangerous names: the raw text
  // here never contains the string "node:child_process" at all.
  describe("obfuscated specifiers are resolved by the parser", () => {
    // Built from an explicit backslash rather than written as escape text.
    // Spelling `n` inline here is unreliable — tooling in this repo has
    // been observed normalising such an escape back into the plain character,
    // which would silently turn these into ordinary un-obfuscated fixtures.
    // A concatenated backslash cannot be collapsed. The guard below enforces it.
    const BS = "\\";
    const HEX = `await import("${BS}x6eode:child_process");`;
    const UNI = `await import("${BS}u006eode:child_process");`;
    const IDENT = `${BS}u0065val("evil");`;

    test("the obfuscated fixtures are actually obfuscated", () => {
      // If these ever contain the plain text, the tests below would be
      // asserting the ordinary case and silently proving nothing.
      expect(HEX).not.toContain("node:child_process");
      expect(UNI).not.toContain("node:child_process");
      expect(IDENT).not.toContain("eval(");
    });

    const obfuscated: Array<[string, string]> = [
      ["hex escapes", HEX],
      ["unicode escapes", UNI],
      [
        "concatenation (non-literal)",
        `const x = "node:child" + "_process";\nawait import(x);`,
      ],
      [
        "template (non-literal)",
        "const m = `child_process`;\nawait import(`node:${m}`);",
      ],
    ];

    for (const [label, source] of obfuscated) {
      test(`blocks specifier hidden by ${label}`, () => {
        expect(scanRuleSource(source).length).toBeGreaterThan(0);
      });
    }

    test("escaped identifiers resolve too", () => {
      expect(scanRuleSource(IDENT).length).toBeGreaterThan(0);
    });
  });
});
