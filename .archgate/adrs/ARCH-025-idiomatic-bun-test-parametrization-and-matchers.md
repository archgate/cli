---
id: ARCH-025
title: Idiomatic bun:test Parametrization and Matchers
domain: architecture
rules: false
files:
  - "tests/**/*.ts"
---

## Context

ARCH-005 governs test isolation, lifecycle, and hygiene (temp directories, spy/env restoration, assertion presence) but does not prescribe how a test author should express "the same check against many inputs" or "a derived true/false fact." Bun's own testing guidance (<https://bun.sh/docs/test/writing-tests>) is prescriptive on both points, and an audit of every file under `tests/**/*.test.ts` in this repository found the two gaps recurring widely enough to be a convention problem rather than isolated mistakes:

1. **Manual loops standing in for `test.each()`/`describe.each()`.** 32 confirmed instances across 8 files — for example `tests/formats/project-config-fuzz.test.ts` (12 instances) and `tests/engine/rule-scanner-escapes.test.ts` (8 instances) each looped over an array of cases and either called `test()` inside the loop body to register cases dynamically, or called `expect()` once per item inside a single test for logically independent scenarios. Bun's docs name this exact shape — "manual loops instead of `test.each()`" — as an anti-pattern.
2. **Generic boolean assertions instead of specific matchers.** 28 confirmed instances across 16 files — `expect(x === y).toBe(true)`, `expect(arr.some(...)).toBe(true)`, `expect(Array.isArray(x)).toBe(true)`, `expect(arr.every(...)).toBe(true)`. Bun's docs explicitly recommend matchers such as `.toHaveLength()`, `.toContain()`, and `.toBeGreaterThanOrEqual()` over wrapping a derived boolean in `.toBe(true)`/`.toBe(false)`.

Both patterns compile, pass `oxlint`, and pass `bun test` — they are not caught by any existing automated check, which is exactly why they spread undetected across 24 independently-written files. They also share a common cost: a manual loop reports one pass/fail for N cases, so a regression in case 3 of 12 is invisible in the test summary and must be found by reading the loop body; a boolean-collapsed assertion reports `expected true, got false` with no indication of which value or array element was actually wrong.

**Alternatives considered:**

- **Add these as more Do's/Don'ts to ARCH-005** — Rejected: ARCH-005 is already 199 lines and its own Compliance section documents that its Do's and Don'ts already exceed the `archgate review-context` briefing budget (2000-char cap); appending more would push more of it out of every future briefing, including the parts already there.
- **Enforce via a new oxlint plugin immediately** — Deferred, not rejected: this repo already has a precedent (`lint/expect-expect.ts`, `lint/no-bare-env-restore.ts`) for exactly this kind of AST-detectable test-shape rule, and it is the right enforcement layer for both patterns (syntax-detectable, not behavioral). Building it is out of scope for the session that produced this ADR, which only fixed existing instances; the rule is recorded as future work in Compliance and Enforcement below.
- **Leave undocumented, rely on code review alone** — Rejected: the instances this ADR responds to were already written by reviewed, merged PRs across 24 files; undocumented convention did not prevent the drift.

## Decision

Tests under `tests/**/*.ts` MUST express "the same assertion logic against multiple inputs" with `test.each()`/`describe.each()`, and MUST assert derived facts with the most specific matcher available rather than collapsing a comparison into a boolean passed to `.toBe(true)`/`.toBe(false)`.

**Scope:** This ADR covers test-case parametrization and matcher choice only. It does not cover test isolation, lifecycle hooks, or fixture/temp-directory handling — those remain governed by ARCH-005.

A loop is "standing in for `test.each()`" when either:

- its body calls `test()`, `it()`, or `describe()` to register a case dynamically, or
- it calls `expect()` once per iteration inside a single test, for items that represent logically independent scenarios (each could fail or pass independently of the others).

A loop that only builds shared setup data or fixtures for a single overall assertion is not covered by this decision.

## Do's and Don'ts

### Do

- **DO** use `test.each(cases)("<title with %s/%p/%d>", (...args) => { ... })` when the same check runs against an array of independent inputs, so each case is its own named, independently-reportable test.
- **DO** use `describe.each(cases)(...)` when each case needs its own group of multiple related tests, not just one assertion.
- **DO** pass array rows (`[a, b, expected]`) for positional destructuring and object rows (`{a, b, expected}`) when the case is easier to read as named fields (format the title with `$field`).
- **DO** assert a derived comparison directly on the values being compared: `expect(actual).toBe(expected)`, `expect(actual).toEqual(expected)`.
- **DO** use the matcher that matches the shape of the check: `.toContain()`/`.toMatch()` for substrings, `.toBeInstanceOf()` for type checks (including `Array.isArray` replacements), `.toHaveLength()` for counts, `.find(...) `+ `.toBeDefined()`/`.toBeUndefined()` for "does at least one item satisfy X."
- **DO** keep the loop→`test.each()` conversion 1:1 — every assertion that ran per-iteration in the original loop must still run per-case in the converted version; a conversion MUST NOT silently drop or merge assertions.

### Don't

- **DON'T** write `for (const case of cases) { test(...); }` or `for (const case of cases) { expect(...); }` inside a single test — use `test.each()`/`describe.each()` instead.
- **DON'T** write `expect(a === b).toBe(true)` or `expect(a === b).toBe(false)` — assert `expect(a).toBe(b)` / `expect(a).not.toBe(b)` directly.
- **DON'T** write `expect(arr.some(predicate)).toBe(true)` or `expect(arr.every(predicate)).toBe(true)` — these collapse an array-wide check into an opaque boolean that reports `false !== true` on failure with no indication of which element (or none) satisfied the predicate. Use `.find(predicate)` + `.toBeDefined()`, a per-item loop of `expect(item).toBe(...)` calls, or a matcher over the mapped values (e.g. `expect(arr.map(x => x.message)).toContain(...)`).
- **DON'T** write `expect(Array.isArray(x)).toBe(true)` — use `expect(x).toBeInstanceOf(Array)`.
- **DON'T** precompute a boolean in a local variable purely to assert it (`const equal = JSON.stringify(a) === JSON.stringify(b); expect(equal).toBe(true);`) — assert on `a` and `b` (or their comparable projections) directly with `.toEqual()`/`.toBe()` so a failure shows the actual diff.

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

- **No automated enforcement yet**: neither pattern is currently caught by `oxlint` or `archgate check`, so new instances can still be introduced and merged undetected, the same way the original 60 were.
  - **Mitigation:** tracked as future work in Compliance and Enforcement below (a candidate `oxlint` plugin following the existing `bun-test/expect-expect` precedent); until it exists, code review is the only enforcement layer, so reviewers MUST check new/changed test files against the Do's and Don'ts above.
- **Existing violations elsewhere in the codebase may resurface**: this ADR's Context reflects a point-in-time audit of 120 files; files not covered by that audit may still contain either anti-pattern.
  - **Mitigation:** treat any test file touched for an unrelated change as an opportunity to fix nearby instances of either pattern, consistent with ARCH-005's existing test-hygiene expectations.

## Compliance and Enforcement

### Automated Enforcement

- **Not yet implemented.** No `oxlint` rule or `archgate` rule currently detects either anti-pattern. A future `oxlint` plugin (e.g. `bun-test/no-loop-test-cases` and `bun-test/no-boolean-collapse`, registered via `jsPlugins` in `.oxlintrc.json` alongside the existing `bun-test/expect-expect` and `test-isolation/no-bare-env-restore` plugins) is the intended enforcement layer once written, matching this repo's existing pattern of using oxlint for syntax-detectable test-shape rules and reserving `archgate` rules for structural/governance checks. This ADR's `rules: false` reflects that no companion `.rules.ts` exists.

### Manual Enforcement

Code reviewers MUST verify, for any new or changed file under `tests/**/*.ts`:

1. No `for`/`.forEach` loop registers a `test()`/`it()`/`describe()` call, and no `for`/`.forEach` loop inside a single test calls `expect()` once per logically independent case — either shape MUST be `test.each()`/`describe.each()` instead.
2. No `expect(<comparison>).toBe(true)` or `.toBe(false)` where `<comparison>` is itself a boolean expression (`===`, `.some()`, `.every()`, `Array.isArray()`, `.includes()`) — the assertion MUST target the underlying values with a specific matcher.
3. A `test.each()`/`describe.each()` conversion preserves every assertion that ran in the original loop — none dropped, none merged into a single case.

### Exceptions

None currently approved. A test file with a genuine reason to keep a loop (e.g. a fuzz/property check verifying one invariant across many generated inputs, where the inputs are not independently meaningful test cases) is not a violation of this ADR in the first place — see the Decision section's definition of what counts as "standing in for `test.each()`."

## References

- [ARCH-005 — Testing Standards](./ARCH-005-testing-standards.md) — governs test isolation, lifecycle hooks, and assertion presence; this ADR covers parametrization and matcher choice specifically and does not restate ARCH-005's conventions.
- [Bun test runner — Writing Tests](https://bun.sh/docs/test/writing-tests) — source of the `test.each()`/`describe.each()` API and the anti-pattern guidance this ADR codifies.
