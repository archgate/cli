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

import {
  scanImportedRuleSource,
  scanRuleSource,
} from "../../src/engine/rule-scanner";

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
    // `require` is a banned global identifier, so naming it in any position
    // (call, alias, argument) is refused.
    test("blocks require()", () => {
      const violations = scanRuleSource(
        `const cp = require("node:child_process");`
      );
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].message).toContain('"require" global');
    });

    test("blocks import.meta.require()", () => {
      const violations = scanRuleSource(
        `const cp = import.meta.require("node:child_process");`
      );
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].message).toContain("import.meta.require()");
    });

    // The computed spelling `import.meta["require"]` reaches the same require()
    // escape. It must be blocked AND report a real position — the anchor is
    // `import.meta` (common to both spellings) so the violation does not remap
    // to line 0 when the original source used brackets.
    test("blocks computed import.meta['require']() with a real position", () => {
      const violations = scanRuleSource(
        `const cp = import.meta["require"]("node:child_process");`
      );
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].message).toContain("import.meta.require()");
      expect(violations[0].line).toBe(1);
    });

    // process internals (`binding`, `dlopen`) reach spawn and native code, but
    // they are reached *through* the `process` global — which is itself banned,
    // so naming `process` in any spelling is what the scanner refuses.
    test("blocks process.binding()", () => {
      const violations = scanRuleSource(
        `const cp = process.binding("spawn_sync");`
      );
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].message).toContain('"process" global');
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
  // A capability reached through a banned global is refused wherever the global
  // is named — dotted, computed, aliased, or chained — because the block is on
  // naming `process`/`globalThis`, not on the property spelling.
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

  // `Bun`, `process`, and the global object are LIVE globals in the rule
  // runtime — reachable with no import at all. Blocking the syntactic shapes
  // (`Bun.spawn`, `Bun[x]`) is the same losing game the module denylist was:
  // aliasing, destructuring, reflection, and global-object aliases all reach
  // the identical capability. The scanner instead blocks *naming* the global.
  describe("reflective and aliased access to runtime globals", () => {
    const reachSpawn: Array<[string, string]> = [
      ["direct Bun.spawn", `Bun.spawn(["ls"]);`],
      ["Reflect.get(Bun, ...)", `Reflect.get(Bun, "spawn")(["ls"]);`],
      ["destructuring Bun", `const { spawn } = Bun;\nspawn(["ls"]);`],
      ["aliasing Bun", `const B = Bun;\nB.spawn(["ls"]);`],
      ["globalThis.Bun.spawn", `globalThis.Bun.spawn(["ls"]);`],
      ["global.Bun.spawn (Node alias)", `global.Bun.spawn(["ls"]);`],
      ["self.Bun.spawn (Web alias)", `self.Bun.spawn(["ls"]);`],
      [
        "Object.getOwnPropertyDescriptor(Bun, ...)",
        `Object.getOwnPropertyDescriptor(Bun, "spawn").value(["ls"]);`,
      ],
      ["Reflect.get(process, ...)", `Reflect.get(process, "binding")("x");`],
    ];

    for (const [label, source] of reachSpawn) {
      test(`blocks ${label}`, () => {
        const violations = scanRuleSource(source);
        expect(violations.length).toBeGreaterThan(0);
      });
    }

    // Every eval-equivalent identifier is banned, and — crucially — so is
    // aliasing it, which the old callee-name checks missed.
    const codegen: Array<[string, string]> = [
      ["eval()", `eval("x");`],
      ["aliased eval", `const e = eval;\ne("x");`],
      ["Function()", `Function("return 1")();`],
      ["new Function()", `new Function("return 1");`],
      ["aliased fetch", `const f = fetch;\nf("http://x");`],
      ["aliased require", `const r = require;\nr("fs");`],
      ["WebSocket", `new WebSocket("ws://x");`],
      ["XMLHttpRequest", `new XMLHttpRequest();`],
      ["EventSource", `new EventSource("http://x");`],
    ];

    for (const [label, source] of codegen) {
      test(`blocks ${label}`, () => {
        expect(scanRuleSource(source).length).toBeGreaterThan(0);
      });
    }

    // `.constructor` reaches the Function constructor (= eval) from any object,
    // which would otherwise bypass every check including the module allowlist.
    test("blocks the Function-constructor chain (dotted)", () => {
      const violations = scanRuleSource(
        `(() => {}).constructor("return 1")();`
      );
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].message).toContain(".constructor");
    });

    test("blocks .constructor via a computed string literal", () => {
      expect(
        scanRuleSource(`(() => {})["constructor"]("return 1")();`).length
      ).toBeGreaterThan(0);
    });

    // Destructuring reaches `.constructor` through a binding pattern the
    // MemberExpression case never sees: `const { constructor: F } = x` READS
    // `x.constructor`. Same eval reach, so the same block must apply.
    const destructured: Array<[string, string]> = [
      [
        "renamed key",
        `const { constructor: F } = (() => {});\nF("return 1")();`,
      ],
      ["computed string key", `const { ["constructor"]: F } = (() => {});`],
      ["shorthand key", `const { constructor } = (() => {});`],
    ];

    for (const [label, source] of destructured) {
      test(`blocks .constructor destructured via ${label}`, () => {
        const violations = scanRuleSource(source);
        expect(violations.length).toBeGreaterThan(0);
        expect(violations[0].message).toContain("constructor");
      });
    }

    // The computed-*variable* key is the same static-analysis residual as the
    // member form above: `{ [c]: F }` with `c` bound at runtime is unknowable
    // without value tracking, so it is left to execution-time isolation rather
    // than chased (blocking all computed destructuring would reject ordinary
    // `const { [k]: v } = obj`). Asserted so the limit stays explicit.
    test("does NOT catch .constructor destructured via a runtime-computed key (known limit)", () => {
      expect(
        scanRuleSource(
          `const c = "constructor";\nconst { [c]: F } = (() => {});`
        )
      ).toHaveLength(0);
    });

    // A property name built at runtime (`obj[variable]`) is unknowable to a
    // scanner that does not track values — the documented static-analysis limit
    // (see ARCH-024). Blocking all computed access would reject ordinary
    // `arr[i]`/`obj[key]`, so this residual is left to execution-time
    // isolation, not chased with more pattern-matching. Asserted so the limit
    // is explicit rather than an accidental gap.
    test("does NOT catch .constructor via a runtime-computed key (known limit)", () => {
      expect(
        scanRuleSource(`const c = "constructor";\nconst F = (() => {})[c];`)
      ).toHaveLength(0);
    });

    test("imported-rule scan applies the same block", () => {
      expect(
        scanImportedRuleSource(`const { spawn } = Bun;`).length
      ).toBeGreaterThan(0);
    });
  });

  // Regression: a node the AST-node schema fails to validate is dropped by
  // `parseNode` *with its entire subtree*, so anything dangerous underneath it
  // goes unscanned — a silent false-negative `check` reports as a pass. The
  // schema's only leaf that can fail is a Literal's `value`: `type` is always
  // present and every other typed field recurses back into the schema. Meriyah
  // emits shapes a narrow `value` union rejects — an object for a RegExp
  // literal, a `bigint` for `123n` — so a payload hidden behind such a literal
  // (`/x/.constructor.constructor`, a banned call to the right of `/re/ + …`)
  // escaped the walk entirely. `value` is now tolerant of any shape.
  describe("payloads behind exotic-literal receivers stay in the walk", () => {
    const escapes: Array<[string, string]> = [
      [
        "Function-constructor chain off a RegExp literal",
        `const F = /x/.constructor.constructor;\nF("return 1")();`,
      ],
      [
        "Function-constructor chain off a bigint literal",
        `const F = (123n).constructor.constructor;`,
      ],
      [
        "banned global to the right of a RegExp literal",
        `const y = /x/ + fetch("http://evil");`,
      ],
      [
        "banned global after a bigint literal statement",
        `const n = 5n;\neval("stealSecrets()");`,
      ],
      [
        "dynamic import alongside a RegExp literal",
        // A reachable position — not `/x/ || import(…)`, which the transpiler
        // strips as dead code (a RegExp literal is always truthy), so the import
        // genuinely never runs and correctly is not scanned.
        `const y = [/x/, import("node:child_process")];`,
      ],
      [
        "import.meta.require after a bigint literal",
        `const n = 5n;\nimport.meta.require("node:fs");`,
      ],
    ];

    for (const [label, source] of escapes) {
      test(`scans a ${label}`, () => {
        expect(scanRuleSource(source).length).toBeGreaterThan(0);
      });
    }

    // Positive controls: the literals themselves are perfectly legal in a rule
    // file — the fix must keep the node in the walk, not start flagging it.
    test("a clean RegExp literal still passes", () => {
      expect(
        scanRuleSource(
          `export default { rules: { r: { check: () => [/ok/] } } };`
        )
      ).toHaveLength(0);
    });

    test("a clean bigint literal still passes", () => {
      expect(
        scanRuleSource(`const size = 10n;\nexport default { rules: {} };`)
      ).toHaveLength(0);
    });
  });

  // Blocking the globals must not swallow the ordinary shapes rules use.
  describe("legitimate global-adjacent code still passes", () => {
    test("allows Object.keys / values / entries", () => {
      expect(
        scanRuleSource(
          `const a = Object.keys({});\nconst b = Object.values({});\nconst c = Object.entries({});`
        )
      ).toHaveLength(0);
    });

    test("allows a property or key that merely shares a global's name", () => {
      expect(
        scanRuleSource(`const cfg = { process: true };\nconst x = cfg.process;`)
      ).toHaveLength(0);
    });

    // A same-named property key BEFORE a real reference must not steal the
    // reported position: the key `Bun` in `{ Bun: true }` is a code occurrence
    // the remapper counts, so the counter has to advance past it for the true
    // `Bun.spawn` reference on line 2 to remap correctly (not onto line 1).
    test("reports the real reference, not an earlier same-named key", () => {
      const violations = scanRuleSource(
        `const cfg = { Bun: true };\nBun.spawn([]);`
      );
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].message).toContain('"Bun" global');
      expect(violations[0].line).toBe(2);
    });

    test("allows a normal RuleContext-only rule", () => {
      const source = `export default { rules: { r: { description: "d", async check(ctx) { const files = await ctx.glob("**/*.ts"); const text = await ctx.readFile(files[0]); if (text.includes("TODO")) ctx.report.warning({ message: "m", file: files[0] }); } } } };`;
      expect(scanRuleSource(source)).toHaveLength(0);
    });
  });
});
