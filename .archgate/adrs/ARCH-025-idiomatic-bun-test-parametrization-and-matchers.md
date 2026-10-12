---
id: ARCH-025
title: Idiomatic bun:test Parametrization and Matchers
domain: architecture
rules: false
files:
  - "tests/**/*.test.ts"
---

## Context

ARCH-005 governs test isolation, lifecycle, and hygiene (temp directories, spy/env restoration, assertion presence) but does not prescribe how a test author should express "the same check against many inputs" or "a derived true/false fact." Bun's own testing guidance (<https://bun.sh/docs/test/writing-tests>) is prescriptive on both points, and an audit of every file under `tests/**/*.test.ts` in this repository found the two gaps recurring widely enough to be a convention problem rather than isolated mistakes:

1. **Manual loops standing in for `test.each()`/`describe.each()`.** Recurred across a cluster of files — for example `tests/formats/project-config-fuzz.test.ts` and `tests/engine/rule-scanner-escapes.test.ts` each looped over an array of cases and either called `test()` inside the loop body to register cases dynamically, or called `expect()` once per item inside a single test for logically independent scenarios. Bun's docs name this exact shape — "manual loops instead of `test.each()`" — as an anti-pattern.
2. **Generic boolean assertions instead of specific matchers.** Recurred even more broadly, across command, engine, and helper test suites alike — `expect(x === y).toBe(true)`, `expect(arr.some(...)).toBe(true)`, `expect(Array.isArray(x)).toBe(true)`, `expect(arr.every(...)).toBe(true)`. Bun's docs explicitly recommend matchers such as `.toHaveLength()`, `.toContain()`, and `.toBeGreaterThanOrEqual()` over wrapping a derived boolean in `.toBe(true)`/`.toBe(false)`.

Both patterns compile, pass `oxlint`, and pass `bun test` — they are not caught by any existing automated check, which is exactly why they spread undetected across many independently-written files. They also share a common cost: a manual loop reports one pass/fail for N cases, so a regression in one case is invisible in the test summary and must be found by reading the loop body; a boolean-collapsed assertion reports `expected true, got false` with no indication of which value or array element was actually wrong.

**Alternatives considered:**

- **Add these as more Do's/Don'ts to ARCH-005** — Rejected: ARCH-005's own Compliance section already documents that its Do's and Don'ts section exceeds the `archgate review-context` briefing budget; appending more would push more of it out of every future briefing, including the parts already there.
- **Enforce via an oxlint plugin** — Adopted for the loop pattern: this repo's precedent (`lint/expect-expect.ts`, `lint/no-bare-env-restore.ts`) is exactly this kind of AST-detectable test-shape rule, and `lint/no-loop-test-cases.ts` follows it. The boolean-collapse pattern is syntax-detectable too and is a candidate for the same layer (Compliance and Enforcement below).
- **Leave undocumented, rely on code review alone** — Rejected: the instances this ADR responds to were already written by reviewed, merged PRs; undocumented convention did not prevent the drift.

## Decision

Tests under `tests/**/*.test.ts` MUST express "the same assertion logic against multiple inputs" with `test.each()`/`describe.each()`, and MUST assert derived facts with the most specific matcher available rather than collapsing a comparison into a boolean passed to `.toBe(true)`/`.toBe(false)`.

**Scope:** This ADR covers test-case parametrization and matcher choice only. It does not cover test isolation, lifecycle hooks, or fixture/temp-directory handling — those remain governed by ARCH-005.

A loop is "standing in for `test.each()`" when either:

- its body calls `test()`, `it()`, or `describe()` to register a case dynamically, or
- it calls `expect()` once per iteration inside a single test, for items that represent logically independent scenarios (each could fail or pass independently of the others).

A loop that only builds shared setup data or fixtures for a single overall assertion is not covered by this decision.

**Runtime-derived collections:** when the iterated collection is produced at runtime — parsed from command output, gathered by a filesystem scan, or returned by the code under test — `test.each()` does not apply, because the rows do not exist at registration time. Such a loop MUST NOT carry a test's only `expect()`: an empty collection runs the body zero times, so the test asserts nothing and passes even when the behavior under test is entirely broken. Assert the collection itself instead — `expect(names).toEqual([...])`, or a length assertion — so an empty result fails. `bun-test/expect-expect` does not catch this, because the `expect()` call is lexically present.

## Do's and Don'ts

### Do

- **DO** use `test.each(cases)("<title with %s/%p/%d>", (...args) => {...})` for the same check against independent inputs — each case becomes its own named test.
- **DO** use `describe.each(cases)(...)` when a case needs a group of related tests, not one assertion.
- **DO** pass array rows (`[a, b, expected]`) for positional destructuring, object rows (`{a, b, expected}`) for named fields (title with `$field`).
- **DO** assert derived comparisons directly on the values: `expect(actual).toBe(expected)` / `.toEqual(expected)`.
- **DO** match the matcher to the check: `.toContain()`/`.toMatch()` for substrings, `.toBeInstanceOf()` for type checks, `.toHaveLength()` for counts, `.find(...)` + `.toBeDefined()`/`.toBeUndefined()` for "does any item satisfy X."
- **DO** keep loop→`test.each()` conversions 1:1 — every per-iteration assertion still runs per case; never drop or merge assertions.

### Don't

- **DON'T** register `test()`/`it()`/`describe()` inside a loop, loop `expect()` over rows that exist at registration time (an array literal or `const` array), or let a loop carry a test's only `expect()` — use `test.each()`, or assert the collection outside the loop.
- **DON'T** write `expect(a === b).toBe(true)` or `.toBe(false)` — assert `expect(a).toBe(b)` / `.not.toBe(b)` directly.
- **DON'T** collapse `.some(predicate)`/`.every(predicate)` into `.toBe(true)` — it reports `false !== true` without saying which element satisfied the predicate. Use `.find(predicate)` + `.toBeDefined()`, a per-item `expect()` loop guarded by an assertion on the whole collection, or a matcher over the mapped values (e.g. `expect(arr.map(x => x.message)).toContain(...)`).
- **DON'T** write `expect(Array.isArray(x)).toBe(true)` — use `expect(x).toBeInstanceOf(Array)`.
- **DON'T** precompute a boolean just to assert it (`const equal = a === b; expect(equal).toBe(true);`) — assert on the values directly with `.toEqual()`/`.toBe()` so a failure shows the actual diff.

## Implementation Pattern

### Good Example

```typescript
// tests/engine/rule-scanner.test.ts
const bannedModules = ["node:fs", "fs", "node:child_process", "child_process"];

test.each(bannedModules)("blocks %s import", (mod) => {
  const violations = scanRuleSource(`import x from "${mod}";`);
  expect(violations.length).toBeGreaterThan(0);
});

test("reports a specific banned-global message", () => {
  const violations = scanRuleSource(`fetch("https://x")`);
  const match = violations.find((v) => v.message.includes('"fetch" global'));
  expect(match).toBeDefined();
});
```

### Bad Example

```typescript
// BAD: a manual loop registers one test per module — a regression in any
// single module's assertion doesn't produce a per-module reported failure
// the same way test.each() would, and adding/removing a case means editing
// loop internals rather than a data table.
for (const mod of ["node:fs", "fs", "node:child_process", "child_process"]) {
  test(`blocks ${mod} import`, () => {
    const violations = scanRuleSource(`import x from "${mod}";`);
    expect(violations.length).toBeGreaterThan(0);
  });
}

// BAD: collapses "does any violation mention fetch" into an opaque boolean —
// on failure this reports "expected true, got false" with no indication of
// what the violations actually were.
expect(violations.some((v) => v.message.includes('"fetch" global'))).toBe(true);
```

## Consequences

### Positive

- **Per-case failure reporting**: `test.each()` gives each input its own named test result, so a regression in one case is immediately identified by name instead of requiring a developer to read a loop body to find which iteration failed.
- **Readable failure diffs**: asserting on the actual compared values (instead of a boolean) means a failing test's output shows what was expected vs. what was received, cutting debugging time.
- **Data-as-table**: adding or removing a case becomes a one-line change to an array/object literal rather than an edit to loop logic.

### Negative

- **More verbose for one-off checks**: a single ad-hoc assertion inside `.some()`/`.every()` is sometimes fewer characters than the specific-matcher equivalent; this ADR accepts that verbosity in exchange for diagnosability.
- **`test.each()` output naming requires care**: a poorly chosen format string (e.g. always `%s` regardless of row shape) produces indistinguishable test names across cases, which undoes the per-case reporting benefit this decision is meant to provide.

### Risks

- **Boolean collapse has no automated enforcement**: `expect(<comparison>).toBe(true)` is caught by neither `oxlint` nor `archgate check`, so new instances can be introduced and merged undetected.
  - **Mitigation:** a `test-cases/no-boolean-collapse` rule beside `no-loop-test-cases` is the intended layer (Compliance and Enforcement below); until it exists, reviewers MUST check new/changed test files against Manual Enforcement item 2.
- **Existing violations elsewhere in the codebase may resurface**: this ADR's Context reflects a repository-wide audit at a point in time; files not covered by that audit, or added afterward, may still contain either anti-pattern.
  - **Mitigation:** treat any test file touched for an unrelated change as an opportunity to fix nearby instances of either pattern, consistent with ARCH-005's existing test-hygiene expectations.

## Compliance and Enforcement

### Automated Enforcement

- **`test-cases/no-loop-test-cases`** (`lint/no-loop-test-cases.ts`, registered in `.oxlintrc.json` `jsPlugins` and enabled as an error for `tests/**/*.test.ts`) reports three shapes: a `test()`/`it()`/`describe()` registered inside a `for`/`for...in`/`for...of`/`while`/`do...while` body or an iteration callback (`.forEach`, `.map`, `.flatMap`, `.filter`, `.some`, `.every`); an `expect()` inside a `for...of` or iteration callback over rows that exist at registration time (a non-empty array literal, or a `const NAME = [...]` binding in module, `describe`, or test scope, including `as const`/`satisfies` forms); and a loop that carries a test's only `expect()` calls. A runtime-derived loop of per-item `expect()`s with an assertion on the collection outside the loop is not reported. Plugin names are unique within `jsPlugins`, so this plugin is `test-cases`.
- **Boolean collapse is unenforced.** No rule detects `expect(<comparison>).toBe(true)`; a `test-cases/no-boolean-collapse` rule in the same plugin is the intended layer. `rules: false` reflects that no companion `.rules.ts` exists: both patterns are syntax-detectable, which this repo enforces with oxlint plugins, reserving `archgate` rules for structural checks.

### Manual Enforcement

Code reviewers MUST verify, for any new or changed file under `tests/**/*.test.ts`:

1. Beyond what `test-cases/no-loop-test-cases` reports, no loop inside a test calls `expect()` once per logically independent case over rows that exist at registration time but are not an array literal or `const` array (for example rows returned by a helper call) — that shape MUST be `test.each()`/`describe.each()` too.
2. No `expect(<comparison>).toBe(true)` or `.toBe(false)` where `<comparison>` is itself a boolean expression (`===`, `.some()`, `.every()`, `Array.isArray()`, `.includes()`) — the assertion MUST target the underlying values with a specific matcher.
3. A `test.each()`/`describe.each()` conversion preserves every assertion that ran in the original loop — none dropped, none merged into a single case.

### Exceptions

None currently approved. A test file with a genuine reason to keep a loop (e.g. a fuzz/property check verifying one invariant across many generated inputs, where the inputs are not independently meaningful test cases) is not a violation of this ADR in the first place — see the Decision section's definition of what counts as "standing in for `test.each()`."

## References

- [ARCH-005 — Testing Standards](./ARCH-005-testing-standards.md) — governs test isolation, lifecycle hooks, and assertion presence; this ADR covers parametrization and matcher choice specifically and does not restate ARCH-005's conventions.
- [Bun test runner — Writing Tests](https://bun.sh/docs/test/writing-tests) — source of the `test.each()`/`describe.each()` API and the anti-pattern guidance this ADR codifies.
