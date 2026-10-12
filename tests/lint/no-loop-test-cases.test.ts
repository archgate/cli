// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { expect, test } from "bun:test";

import plugin from "../../lint/no-loop-test-cases";
import { parseJsModule } from "../../src/engine/js-parser";

/** Minimal ESTree-ish node shape, matching the plugin's own definition. */
type AstNode = { type: string } & Record<string, unknown>;

interface ReportedViolation {
  message: string;
}

/**
 * Run the `test-cases/no-loop-test-cases` rule against a source snippet and
 * return every reported violation. Parses via the in-process `meriyah`
 * entry point (`parseJsModule`, ARCH-022) the engine itself uses.
 */
function lint(source: string): ReportedViolation[] {
  // meriyah's Program type structurally satisfies the plugin's own loose
  // AstNode shape; the plugin doesn't export a type to convert through.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const program = parseJsModule(source) as unknown as AstNode;
  const violations: ReportedViolation[] = [];
  const rule = plugin.rules["no-loop-test-cases"];
  const visitor = rule.create({
    report({ message }) {
      violations.push({ message });
    },
  });
  visitor.Program(program);
  return violations;
}

const REGISTRATION = "registered inside a loop";
const STATIC_ROWS = "rows that exist at registration time";
const ONLY = "only `expect()` calls";

test.each([
  {
    name: "for...of registering test()",
    source: `for (const c of cases) { test("x " + c, () => { expect(c).toBe(1); }); }`,
    expectedCount: 1,
    keyword: REGISTRATION,
  },
  {
    name: ".forEach registering it()",
    source: `cases.forEach((c) => { it("x", () => { expect(c).toBe(1); }); });`,
    expectedCount: 1,
    keyword: REGISTRATION,
  },
  {
    name: "for registering describe() whose body registers test (one report)",
    source: `for (let i = 0; i < 3; i++) { describe("d", () => { test("x", () => { expect(i).toBe(1); }); }); }`,
    expectedCount: 1,
    keyword: REGISTRATION,
  },
  {
    name: "test.each(rows)(...) inside a for",
    source: `for (const g of groups) { test.each(rows)("x %s", (r) => { expect(r).toBe(g); }); }`,
    expectedCount: 1,
    keyword: REGISTRATION,
  },
  {
    name: "test.skipIf(c)(...) inside a while",
    source: `while (more()) { test.skipIf(c)("x", () => { expect(1).toBe(1); }); }`,
    expectedCount: 1,
    keyword: REGISTRATION,
  },
  {
    name: "describe.each(rows)(...) at top level",
    source: `describe.each(rows)("d %s", (r) => { test("x", () => { expect(r).toBe(1); }); });`,
    expectedCount: 0,
    keyword: "",
  },
  {
    name: "array literal for...of inside a test",
    source: `test("t", () => { for (const c of [1, 2]) { expect(f(c)).toBe(c); } });`,
    expectedCount: 1,
    keyword: STATIC_ROWS,
  },
  {
    name: "const array identifier for...of inside a test",
    source: `const CASES = [1, 2]; test("t", () => { for (const c of CASES) expect(f(c)).toBe(c); });`,
    expectedCount: 1,
    keyword: STATIC_ROWS,
  },
  {
    name: ".forEach over a const array inside a test",
    source: `const CASES = [1, 2]; test("t", () => { CASES.forEach((c) => expect(f(c)).toBe(c)); });`,
    expectedCount: 1,
    keyword: STATIC_ROWS,
  },
  {
    name: ".forEach over an array literal inside a test",
    source: `test("t", () => { [1, 2].forEach((c) => { expect(f(c)).toBe(c); }); });`,
    expectedCount: 1,
    keyword: STATIC_ROWS,
  },
  {
    name: "static rows still flag with another expect outside the loop",
    source: `test("t", () => { expect(g()).toBe(1); for (const c of [1, 2]) { expect(f(c)).toBe(c); } });`,
    expectedCount: 1,
    keyword: STATIC_ROWS,
  },
  {
    name: "negated expect over static rows",
    source: `test("t", () => { for (const c of [1, 2]) { expect(f(c)).not.toBe(0); } });`,
    expectedCount: 1,
    keyword: STATIC_ROWS,
  },
  {
    name: "two expects in one static loop report once",
    source: `test("t", () => { for (const c of [1, 2]) { expect(f(c)).toBe(c); expect(g(c)).toBe(c); } });`,
    expectedCount: 1,
    keyword: STATIC_ROWS,
  },
  {
    name: "runtime for...of carrying the only expect",
    source: `test("t", () => { for (const r of results) { expect(r.ok).toBe(true); } });`,
    expectedCount: 1,
    keyword: ONLY,
  },
  {
    name: "while loop carrying the only expect",
    source: `test("t", () => { while (next()) { expect(cur()).toBe(1); } });`,
    expectedCount: 1,
    keyword: ONLY,
  },
  {
    name: "do...while loop carrying the only expect",
    source: `test("t", () => { do { expect(cur()).toBe(1); } while (next()); });`,
    expectedCount: 1,
    keyword: ONLY,
  },
  {
    name: ".forEach over a non-literal identifier carrying the only expect",
    source: `test("t", () => { results.forEach((r) => { expect(r.ok).toBe(true); }); });`,
    expectedCount: 1,
    keyword: ONLY,
  },
  {
    name: "nested runtime loops report the outermost once",
    source: `test("t", () => { for (const a of as) { for (const b of a.items) { expect(b).toBe(1); } } });`,
    expectedCount: 1,
    keyword: ONLY,
  },
  {
    name: "let-bound array carrying the only expect is a runtime loop",
    source: `let rows = [1, 2]; test("t", () => { for (const r of rows) { expect(r).toBe(1); } });`,
    expectedCount: 1,
    keyword: ONLY,
  },
  {
    name: "guarded shape: expect outside plus per-item expects",
    source: `test("t", () => { expect(results).toHaveLength(3); for (const r of results) expect(r.ok).toBe(true); });`,
    expectedCount: 0,
    keyword: "",
  },
  {
    name: "loop that only builds fixtures before the assertion",
    source: `test("t", () => { const out = []; for (const r of results) { out.push(r.name); } expect(out).toEqual(["a"]); });`,
    expectedCount: 0,
    keyword: "",
  },
  {
    name: "guarded Promise.all(items.map(...))",
    source: `test("t", async () => { expect(items).toHaveLength(2); await Promise.all(items.map(async (i) => { expect(await f(i)).toBe(1); })); });`,
    expectedCount: 0,
    keyword: "",
  },
  {
    name: "unguarded Promise.all(items.map(...)) carries the only expects",
    source: `test("t", async () => { await Promise.all(items.map(async (i) => { expect(await f(i)).toBe(1); })); });`,
    expectedCount: 1,
    keyword: ONLY,
  },
  {
    name: ".map callback carrying the only expect",
    source: `test("t", () => { items.map((i) => expect(i).toBe(1)); });`,
    expectedCount: 1,
    keyword: ONLY,
  },
  {
    name: ".some callback carrying the only expect",
    source: `test("t", () => { items.some((i) => expect(i).toBe(1)); });`,
    expectedCount: 1,
    keyword: ONLY,
  },
  {
    name: ".map over an array literal",
    source: `test("t", () => { [1, 2].map((x) => expect(f(x)).toBe(x)); });`,
    expectedCount: 1,
    keyword: STATIC_ROWS,
  },
  {
    name: "a callback outside the iteration methods is not a loop",
    source: `test("t", () => { run(items, (i) => expect(i).toBe(1)); });`,
    expectedCount: 0,
    keyword: "",
  },
  {
    name: "an `it` variable that is not a registration",
    source: `for (const it of items) { it.run(); }`,
    expectedCount: 0,
    keyword: "",
  },
  {
    name: "a `test` variable that is not a registration",
    source: `for (const test of suite.tests) { test.run(); }`,
    expectedCount: 0,
    keyword: "",
  },
  {
    name: "test.concurrent registered in a loop",
    source: `for (const c of rows) { test.concurrent(c.name, () => {}); }`,
    expectedCount: 1,
    keyword: REGISTRATION,
  },
  {
    name: "local const table in one test, runtime value of the same name in another",
    source: `test("a", () => { const cases = [1, 2]; for (const c of cases) expect(c).toBe(c); }); test("b", async () => { const cases = await load(); expect(cases).toHaveLength(2); for (const c of cases) expect(c).toBe(c); });`,
    expectedCount: 1,
    keyword: STATIC_ROWS,
  },
  {
    name: "empty array accumulator is a runtime collection",
    source: `test("t", () => { const found = []; found.push(1); for (const f of found) expect(f).toBe(1); });`,
    expectedCount: 1,
    keyword: ONLY,
  },
  {
    name: "const table declared in a describe block",
    source: `describe("d", () => { const ROWS = [1, 2]; test("t", () => { for (const r of ROWS) expect(r).toBe(r); }); });`,
    expectedCount: 1,
    keyword: STATIC_ROWS,
  },
  {
    name: "expect.soft outside the loop guards a runtime loop",
    source: `test("t", () => { expect.soft(results.length).toBeGreaterThan(0); for (const r of results) expect(r.ok).toBe(true); });`,
    expectedCount: 0,
    keyword: "",
  },
  {
    name: "expect inside a loop in a beforeEach hook",
    source: `beforeEach(() => { for (const r of results) { expect(r.ok).toBe(true); } });`,
    expectedCount: 0,
    keyword: "",
  },
  {
    name: "loop in a describe callback outside any test",
    source: `describe("d", () => { for (const r of [1, 2]) { expect(r).toBe(1); } });`,
    expectedCount: 0,
    keyword: "",
  },
  {
    name: "test.each(rows) with a loop-free body",
    source: `test.each(rows)("x %s", (r) => { expect(f(r)).toBe(1); });`,
    expectedCount: 0,
    keyword: "",
  },
  {
    name: "expect inside a nested arrow helper that is not a loop",
    source: `test("t", () => { const check = (x) => { expect(x).toBe(1); }; check(1); });`,
    expectedCount: 0,
    keyword: "",
  },
  {
    name: "test with no loop at all",
    source: `test("t", () => { expect(1).toBe(1); });`,
    expectedCount: 0,
    keyword: "",
  },
])("$name", ({ source, expectedCount, keyword }) => {
  const violations = lint(source);
  expect(violations).toHaveLength(expectedCount);
  expect(violations.filter((v) => !v.message.includes(keyword))).toEqual([]);
});

test.each([
  {
    shape: "registration inside a loop",
    source: `for (const c of cases) { test("x", () => { expect(c).toBe(1); }); }`,
  },
  {
    shape: "expect over static rows",
    source: `test("t", () => { for (const c of [1]) { expect(c).toBe(1); } });`,
  },
  {
    shape: "loop carrying the only expects",
    source: `test("t", () => { for (const r of results) { expect(r).toBe(1); } });`,
  },
])("the $shape message names ARCH-025", ({ source }) => {
  const violations = lint(source);
  expect(violations).toHaveLength(1);
  expect(violations[0]?.message).toContain("(ARCH-025)");
});

function findDeclarator(node: AstNode): AstNode | undefined {
  if (node.type === "VariableDeclarator") return node;
  for (const value of Object.values(node)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "object" && item !== null && "type" in item) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const found = findDeclarator(item as AstNode);
        if (found) return found;
      }
    }
  }
  return undefined;
}

// oxlint's TypeScript AST wraps `[...] as const` and similar in a
// TSAsExpression; meriyah cannot parse those, so the wrapper is added to the
// parsed tree by hand.
test("static rows behind a TypeScript wrapper are still static", () => {
  const program = parseJsModule(
    `const CASES = [1, 2]; test("x", () => { for (const c of CASES) expect(c).toBe(c); });`
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const ast = program as unknown as AstNode;
  const declarator = findDeclarator(ast);
  if (!declarator) throw new Error("fixture has no declarator");
  declarator.init = {
    type: "TSAsExpression",
    expression: declarator.init,
    typeAnnotation: { type: "TSTypeReference" },
  };
  const violations: ReportedViolation[] = [];
  const visitor = plugin.rules["no-loop-test-cases"].create({
    report({ message }) {
      violations.push({ message });
    },
  });
  visitor.Program(ast);
  expect(violations).toHaveLength(1);
  expect(violations[0]?.message).toContain(STATIC_ROWS);
});
