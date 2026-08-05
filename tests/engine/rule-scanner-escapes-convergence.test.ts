// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Entry-point convergence proof for the `.rules.ts` scanner: one corpus of
 * payloads (one per blocked category in rule-scanner-escapes.test.ts) runs
 * through both `scanRuleSource` and `scanImportedRuleSource`, asserting
 * deeply-equal results — escapes blocked identically, and clean payloads
 * permitted identically (no over-rejection on the imported path).
 *
 * @see ARCH-024 Manual Enforcement item 9, ARCH-022 Decision clause 1.
 */
import { describe, expect, test } from "bun:test";

import {
  scanImportedRuleSource,
  scanRuleSource,
} from "../../src/engine/rule-scanner";

const RLO = String.fromCodePoint(0x202e);
const ZWSP = String.fromCodePoint(0x200b);
// Built from an explicit backslash so tooling cannot normalise the escape
// back into the plain character (same guard as rule-scanner-escapes.test.ts).
const BS = "\\";

/** One payload per blocked category of the escape suite. */
const ESCAPE_PAYLOADS: Array<[string, string]> = [
  // Module allowlist
  [
    "dynamic import of a builtin",
    `const m = await import("node:child_process");`,
  ],
  ["relative import of an unscanned file", `import { x } from "./evil.ts";`],
  [
    "data: URL import",
    `const m = await import("data:text/javascript,export default 1");`,
  ],
  ["bare npm package", `import x from "some-npm-pkg";`],
  ["createRequire import", `import { createRequire } from "node:module";`],
  ["re-export star", `export * from "node:child_process";`],
  ["re-export named", `export { spawn } from "node:child_process";`],
  ["shadowable bare 'path'", `import { basename } from "path";`],
  // require / process internals
  ["require()", `const cp = require("node:child_process");`],
  [
    "import.meta.require()",
    `const cp = import.meta.require("node:child_process");`,
  ],
  [
    "computed import.meta['require']()",
    `const cp = import.meta["require"]("node:child_process");`,
  ],
  ["process.binding()", `const cp = process.binding("spawn_sync");`],
  [
    "globalThis.process.binding()",
    `const cp = globalThis.process.binding("spawn_sync");`,
  ],
  ["process.dlopen()", `process.dlopen(m, "evil.node");`],
  // Computed access and aliased receivers
  ["computed literal key", `const cp = process["binding"]("spawn_sync");`],
  ["aliased receiver, dotted", `const p = process;\np.dlopen(m, "e.node");`],
  [
    "alias chain through globalThis",
    `const g = globalThis;\nconst p = g["process"];\np["binding"]("spawn_sync");`,
  ],
  // Invisible and bidi characters (raw-text pass)
  ["bidi override in a comment", `/* ${RLO} */ const x = 1;`],
  ["zero-width space in an identifier", `const a${ZWSP}b = 1;`],
  ["hidden character in unparseable source", `const ${RLO} = ;;;`],
  // Obfuscated specifiers resolved by the parser
  ["hex-escaped specifier", `await import("${BS}x6eode:child_process");`],
  ["unicode-escaped specifier", `await import("${BS}u006eode:child_process");`],
  [
    "concatenated non-literal specifier",
    `const x = "node:child" + "_process";\nawait import(x);`,
  ],
  [
    "template non-literal specifier",
    "const m = `child_process`;\nawait import(`node:${m}`);",
  ],
  ["escaped identifier", `${BS}u0065val("evil");`],
  // Reflective and aliased access to runtime globals
  ["direct Bun.spawn", `Bun.spawn(["ls"]);`],
  ["Reflect.get(Bun, ...)", `Reflect.get(Bun, "spawn")(["ls"]);`],
  ["destructuring Bun", `const { spawn } = Bun;\nspawn(["ls"]);`],
  ["aliasing Bun", `const B = Bun;\nB.spawn(["ls"]);`],
  ["globalThis.Bun.spawn", `globalThis.Bun.spawn(["ls"]);`],
  ["global.Bun.spawn (Node alias)", `global.Bun.spawn(["ls"]);`],
  ["self.Bun.spawn (Web alias)", `self.Bun.spawn(["ls"]);`],
  [
    "getOwnPropertyDescriptor(Bun, ...)",
    `Object.getOwnPropertyDescriptor(Bun, "spawn").value(["ls"]);`,
  ],
  // Code generation
  ["eval()", `eval("x");`],
  ["aliased eval", `const e = eval;\ne("x");`],
  ["Function()", `Function("return 1")();`],
  ["new Function()", `new Function("return 1");`],
  ["aliased fetch", `const f = fetch;\nf("http://x");`],
  ["WebSocket", `new WebSocket("ws://x");`],
  ["XMLHttpRequest", `new XMLHttpRequest();`],
  ["EventSource", `new EventSource("http://x");`],
  // Function-constructor chains
  ["dotted .constructor chain", `(() => {}).constructor("return 1")();`],
  ["computed .constructor chain", `(() => {})["constructor"]("return 1")();`],
  [
    "destructured .constructor",
    `const { constructor: F } = (() => {});\nF("return 1")();`,
  ],
  // Payloads behind exotic-literal receivers
  [
    "constructor chain off a RegExp literal",
    `const F = /x/.constructor.constructor;\nF("return 1")();`,
  ],
  [
    "banned global after a bigint literal",
    `const n = 5n;\neval("stealSecrets()");`,
  ],
  [
    "dynamic import alongside a RegExp literal",
    `const y = [/x/, import("node:child_process")];`,
  ],
];

/** Shapes real rule files use — both entry points must permit them. */
const CLEAN_PAYLOADS: Array<[string, string]> = [
  ["plain local export", `const x = 1;\nexport { x };`],
  ["type-only import", `import type { Foo } from "./foo";\nconst x: Foo = 1;`],
  ["allowlisted node:path import", `import { basename } from "node:path";`],
  [
    "clean RegExp literal",
    `export default { rules: { r: { check: () => [/ok/] } } };`,
  ],
  [
    "ordinary computed access",
    `const o = { a: 1 };\nconst k = "a";\nconst v = o[k];`,
  ],
  [
    "normal RuleContext-only rule",
    `export default { rules: { r: { description: "d", async check(ctx) { const files = await ctx.glob("**/*.ts"); const text = await ctx.readFile(files[0]); if (text.includes("TODO")) ctx.report.warning({ message: "m", file: files[0] }); } } } };`,
  ],
];

describe("scanner entry-point convergence", () => {
  test.each(ESCAPE_PAYLOADS)(
    "both entry points block %s, identically",
    (_label, source) => {
      const firstParty = scanRuleSource(source);
      const imported = scanImportedRuleSource(source);
      expect(firstParty.length).toBeGreaterThan(0);
      expect(imported).toEqual(firstParty);
    }
  );

  test.each(CLEAN_PAYLOADS)(
    "both entry points allow %s, identically",
    (_label, source) => {
      const firstParty = scanRuleSource(source);
      const imported = scanImportedRuleSource(source);
      expect(firstParty).toHaveLength(0);
      expect(imported).toEqual(firstParty);
    }
  );

  test("the obfuscated fixtures are actually obfuscated", () => {
    const byLabel = new Map(ESCAPE_PAYLOADS);
    expect(byLabel.get("hex-escaped specifier")).not.toContain(
      "node:child_process"
    );
    expect(byLabel.get("unicode-escaped specifier")).not.toContain(
      "node:child_process"
    );
    expect(byLabel.get("escaped identifier")).not.toContain("eval(");
  });
});
