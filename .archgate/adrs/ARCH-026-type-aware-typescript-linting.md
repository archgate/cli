---
id: ARCH-026
title: Type-Aware TypeScript Linting
domain: architecture
rules: true
files:
  - ".oxlintrc.json"
  - "package.json"
---

## Context

`oxlint` has always run purely syntactically — its rules see the AST but never resolve a type. That misses an entire class of real bugs: an `any` value flowing untouched from `JSON.parse()` into a typed API, a `Bun.spawn()` mock left untyped so its `.mock.calls` are opaque, a function that manually wraps a value in `Promise.resolve()` instead of being declared `async`. TypeScript's own compiler (`tsc --build`, ARCH-005/`bun run typecheck`) catches type _errors_, but it does not catch type-safety _style_ violations — code that compiles cleanly while still being unsafe (an unchecked cast, a floating promise, a nullable value used as a boolean).

`typescript-eslint` has closed this gap for ESLint-based projects for years via its type-aware rule set, but oxlint — a from-scratch Rust reimplementation of the ESLint/typescript-eslint rule catalog for speed (see ARCH-006's "prefer built-ins, minimize dependencies" philosophy, which this project already leans on for tooling) — could not, because it never had access to type information. `oxlint-tsgolint` closes that gap: it wraps `typescript-go` (the officially Go-ported TypeScript compiler, shipped starting with TypeScript 7) to give oxlint real type information without paying ESLint's per-file compiler-instantiation cost.

Adopting it required two prerequisite decisions this ADR also documents: pinning an explicit, deterministic TypeScript version (previously this project only declared a `peerDependencies` range on `typescript`, resolved transitively and non-deterministically by whatever the package manager happened to pick), and deciding how much of typescript-eslint's ~59 type-aware rule catalog to actually turn on.

**Alternatives considered:**

- **Stay on syntactic-only oxlint, rely on `tsc --build` alone for type safety.** Rejected: `tsc` reports type _errors_ (code that doesn't type-check), not type-safety _style_ violations (code that type-checks but is still unsafe — an untyped `any` silently flowing through, a floating promise, a nullable value in a boolean position). These are exactly the bugs type-aware linting exists to catch, and `tsc` structurally cannot report them since they are not compiler errors.
- **Adopt `typescript-eslint` directly instead of `oxlint-tsgolint`.** Rejected: this project already migrated its entire lint stack to `oxlint` for speed and a single-tool setup; reintroducing ESLint's plugin ecosystem alongside oxlint for type-aware rules alone would mean running two linters, doubling CI cost and reintroducing the per-file TypeScript-compiler-instantiation overhead oxlint was adopted to avoid.
- **Enable every available type-aware rule at `"error"` with no exclusions.** Rejected — see the `prefer-readonly-parameter-types` and `require-await` exclusions in Decision below; blanket adoption produced ~930 (of ~3546 trialed) findings from a single rule that typescript-eslint itself does not enable in its own "recommended" or "strict" presets, and a direct, unresolvable rule-vs-rule contradiction for a common, correct code shape.
- **Enable type-aware linting but leave the `typescript` version on its old peer-only, transitively-resolved range.** Rejected: type-aware linting requires TypeScript 7.0+ to function at all (`oxlint-tsgolint` wraps `typescript-go`, which ships from TS 7 onward), and a peer-only declaration gives no guarantee about which version is actually installed locally or in CI — the exact non-determinism this ADR's TypeScript-pinning decision closes.

For a CLI whose own `src/engine/` implements a rule-execution system that inspects other projects' TypeScript/JavaScript for architectural drift (ARCH-022), running the most capable available linter against its own codebase is directly on-mission — dogfooding compounds here.

## Decision

This project pins an explicit `typescript` devDependency and enables oxlint's type-aware linting engine with a curated subset of the available `typescript/*` rules.

**TypeScript version:** `typescript` MUST be an explicit, exact-pinned `devDependency` in `package.json` (currently `7.0.2`), not left to resolve transitively — see Key Definitions: Version Pairing.

**Type-aware linting:** `.oxlintrc.json` sets `"options": { "typeAware": true }` at the root — the only place oxlint honors this option.

**Rule selection:** All type-aware `typescript/*` rules currently implemented by `oxlint-tsgolint` are enabled at `"error"` in `.oxlintrc.json`, except `typescript/prefer-readonly-parameter-types` and `require-await` (both the base ESLint rule and `typescript/require-await`) — see Key Definitions: Excluded Rules. **Scope:** this decision governs `typescript/*` rule enablement and the TypeScript/`oxlint-tsgolint` version-pinning contract only; base (non-type-aware) oxlint rule selection predates this ADR and is unchanged.

**Scope exclusions:** `shims/**`, `docs/**`, and `.simple-release.js` are excluded from type-aware analysis — see Key Definitions: Scope Exclusions.

## Do's and Don'ts

### Do

- **DO** treat `oxlint --rules -f json` (filter `"type_aware": true`) as the only authoritative source for which type-aware rules exist — see Key Definitions: Rule Discovery.
- **DO** set an excluded rule to `"off"` explicitly, never just omit it from the `rules` block — category-level severity sweeps in omitted rules regardless of their own `default` flag.
- **DO** keep `oxlint-tsgolint`'s version paired to the installed `typescript` version when bumping either — see Key Definitions: Version Pairing.
- **DO** type `bun:test` spies precisely with `Mock<typeof obj.method>` (from `"bun:test"`), not untyped `ReturnType<typeof spyOn>` — see Key Definitions: Spy Typing.
- **DO** declare `async () => value`, not `() => Promise.resolve(value)` — `promise-function-async` requires `async` on any function returning `Promise<T>`.
- **DO** drop `await` before `expect(promiseExpr).rejects.toThrow(...)` / `.resolves.toBe(...)` — see Key Definitions: Sync Matchers.
- **DO** suppress narrowly: only a fake test fixture or a proven `tsc`-vs-`tsgolint` parity gap (Key Definitions: Parity Gaps), directive on the line immediately before the flagged code.

### Don't

- **DON'T** enable `typescript/prefer-readonly-parameter-types` — see Key Definitions: Excluded Rules.
- **DON'T** re-enable `require-await` (base or `typescript/require-await`) without reconciling it against `typescript/promise-function-async` — see Key Definitions: Excluded Rules.
- **DON'T** trust a `tsc`/`tsgolint` disagreement without reasoning through the actual type semantics yourself — see Key Definitions: Parity Gaps.
- **DON'T** retrofit JSDoc type annotations into `.simple-release.js` or similar third-party-extending plain-`.js` config scripts to satisfy type-aware rules — see Key Definitions: Scope Exclusions.
- **DON'T** widen the `shims/**`/`docs/**`/`.simple-release.js` exclusions without the equivalent documented justification each already has — see Key Definitions: Scope Exclusions.

## Key Definitions

- **Rule Discovery:** Scraped documentation and GitHub READMEs are unreliable for a tool this new — one such source, consulted while authoring this decision, listed `typescript/naming-convention` and `typescript/prefer-destructuring` as implemented; the installed binary's own `--rules` output does not include either.
- **Excluded Rules:** `typescript/prefer-readonly-parameter-types` is excluded because `typescript-eslint` itself keeps it out of both its "recommended" and "strict" presets, offering it only as an opt-in "strict-type-checked extra" with an explicit noise warning — trialed against this codebase it produced ~930 of ~3546 total findings, more than every other type-aware rule combined, annotating nearly every object/array-typed parameter repository-wide for no proportionate safety benefit. `require-await` is excluded because it directly contradicts `typescript/promise-function-async` for the common "function that trivially resolves an already-known value, declared `async` to match an interface, with no real internal `await`" shape (e.g. test mocks/stubs) — `promise-function-async` demands `async`, `require-await` then demands it be removed since there's no internal `await`. `promise-function-async` was kept as the rule with genuine type-safety signal.
- **Version Pairing:** `oxlint-tsgolint` versions like `7.0.2001` encode the TypeScript release they support in the leading digits (`7.0.2001` → TS `7.0.x`). Renovate opens independent PRs for `typescript` and `oxlint-tsgolint`, so a `typescript` major/minor bump MUST be checked against `oxlint-tsgolint` compatibility before merging. `package.json` no longer declares a `peerDependencies.typescript` range — it was investigated and confirmed vestigial (load-bearing only until an early PR removed the `defineRules()`/`./rules` export mechanism it originally protected; `.rules.ts` files load via Bun's own runtime transpilation and never touch a consumer's installed `typescript` package) and removed rather than left as dead configuration.
- **Spy Typing:** `ReturnType<typeof spyOn>` with no type arguments erases to an effectively-`any` type under `Parameters<>` extraction, which is what produced the overwhelming majority of `no-unsafe-call`/`no-unsafe-member-access`/`no-unsafe-assignment` findings when this rule set was first enabled.
- **Sync Matchers:** In this project's `bun-types` version, `expect(x).rejects`/`.resolves` are typed as synchronous (`Matchers<unknown>`, not `Promise<Matchers<unknown>>>`), and matcher methods like `.toThrow()` return `void`. This was verified empirically — a deliberately-wrong `.rejects.toThrow()` assertion still correctly fails the test without `await` — before relying on it; do not assume a lint rule's suggested fix is behavior-preserving without checking.
- **Parity Gaps:** One genuine `tsc`-vs-`tsgolint` disagreement surfaced during this migration: a function parameter with a default value (`options: {...} = {}`) makes that parameter _optional_ in `Parameters<typeof fn>`'s tuple type, so indexing a captured `mock.calls[0][2]` is legitimately `T | undefined` under `tsc`'s own type semantics. `tsgolint` did not model that optional-trailing-tuple-element nuance and flagged the resulting non-null assertion as "unnecessary." `tsc` was right; the fix was a justified suppression on `no-unnecessary-type-assertion`, not removing the assertion.
- **Scope Exclusions:** `shims/**` (deliberately untyped, hand-written distribution CJS per [ARCH-017](./ARCH-017-multi-ecosystem-distribution.md), never part of the `tsc` project) has type-aware rules disabled via an `.oxlintrc.json` `overrides` entry while keeping base (non-type-aware) category checks active. `docs/**` is a separate sub-project with its own `package.json`/`bun.lock`, never installed by the root `bun install`, so its `tsconfig.json` cannot resolve here. `.simple-release.js` is release tooling outside the shipped CLI or its tests — attempting to JSDoc-annotate it for real types made things worse, not better: an unresolved `@typedef {import("@simple-release/core").ProjectBumpOptions}` cascaded into unrelated "error"-typed inference across the entire file rather than fixing anything, so it is excluded entirely via `ignorePatterns` instead. A new exclusion needs an equivalent, documented reason, not "it had findings."

## Consequences

### Positive

- **Catches real safety gaps `tsc` structurally cannot.** Floating promises, unchecked `any` propagation, unsafe type assertions, and nullable-in-boolean-position bugs now surface at lint time instead of at runtime or not at all.
- **Deterministic builds.** Pinning `typescript` as an explicit `devDependency` means every clone and every CI run resolves the identical compiler version; the prior peer-only declaration could silently drift.
- **Faster than the ESLint-based alternative.** `oxlint-tsgolint` wraps `typescript-go` directly rather than instantiating the classic TypeScript compiler per file the way `typescript-eslint` does, keeping this project on a single, fast lint tool instead of running oxlint and ESLint side by side.
- **Self-documenting exclusions.** Every rule/path this ADR excludes carries an inline `.oxlintrc.json` comment explaining why, so a future contributor auditing the config sees the reasoning at the point of the decision, not just in this document.
- **Dogfooding alignment.** A CLI that inspects other codebases for architectural drift (ARCH-022) now applies the strongest available static analysis to itself.

### Negative

- **New, immature tooling.** `oxlint-tsgolint` and TypeScript 7 (`typescript-go`) are both new — TypeScript 7.0 shipped without a public compiler API (a 7.1 API is expected later), and this migration surfaced at least one confirmed `tsc`/`tsgolint` parity gap (see the Don'ts above). More may exist.
- **Version-pairing maintenance burden.** `oxlint-tsgolint`'s version must track `typescript`'s; Renovate cannot know this, so every `typescript` bump needs a manual compatibility check against `oxlint-tsgolint` rather than being a fire-and-forget dependency update.
- **Partial rule adoption is an explicit trade-off, not full coverage.** Excluding `prefer-readonly-parameter-types` means this codebase does not get that rule's readonly-parameter guarantees anywhere, even where they would be cheap to satisfy — the exclusion is repository-wide, not case-by-case.

### Risks

- **A future TypeScript bump breaks type-aware linting silently if `oxlint-tsgolint` isn't bumped in step**, since Renovate treats the two dependencies independently. **Mitigation:** documented explicitly in Do's and Don'ts above; the companion rule (see Compliance and Enforcement) checks that both are present as `devDependencies`, making a one-sided removal or omission visible, though it cannot itself verify version _compatibility_ between the two.
- **`tsgolint`'s type-system modeling gaps produce false "unnecessary assertion" or similar reports**, as happened with the optional-trailing-tuple-element case documented above. **Mitigation:** the Don'ts above establish the standard of proof (reason through the actual type semantics, don't just trust either tool) and the suppression policy (narrow, one-line-justified, immediately-adjacent `oxlint-disable-next-line`) for when `tsc` is confirmed right and `tsgolint` wrong.
- **`options.typeAware: true` is silently ignored if set outside the root `.oxlintrc.json`** (oxlint only honors it there). **Mitigation:** this project has a single root config with no nested per-directory `.oxlintrc.json` files; the companion rule checks the root file specifically.
- **`.archgate/adrs/*.rules.ts` files depend on the gitignored `.archgate/rules.d.ts` ambient-types shim for `ctx.*` to type-check** — it's otherwise only regenerated as a side effect of `archgate check`, which `bun run validate`'s pipeline runs _after_ `lint`. On a fresh checkout (a new clone, or CI) the shim doesn't exist yet, so every `ctx.*` access resolves to `any`/`error` instead of `RuleContext` — a failure mode a long-lived local working directory never reproduces, since the shim persists on disk once generated once. **Mitigation:** `bun run lint` runs `scripts/ensure-rules-dts.ts` first to regenerate the shim unconditionally before oxlint runs.

## Compliance and Enforcement

### Automated

- **Archgate rule** `ARCH-026/type-aware-linting-configured`: Verifies the root `.oxlintrc.json` has `options.typeAware === true` and that `package.json` `devDependencies` include both `typescript` and `oxlint-tsgolint`. Severity: error.
- **oxlint itself**: `bun run lint` (`oxlint --deny-warnings .`) enforces every enabled `typescript/*` rule on every run, including CI.

### Manual

Code reviewers MUST verify:

1. A newly-added `oxlint-disable-next-line` directive for a `typescript/*` rule carries a one-line reason immediately above it, and that reason is one of the two justified categories in Do's and Don'ts (deliberately-fake test fixture, or a demonstrated `tsc`/`tsgolint` parity gap) — not a rule the author simply found inconvenient.
2. A PR bumping `typescript` also checks (and bumps if needed) `oxlint-tsgolint` to a compatible version before merging.
3. A new `bun:test` spy declaration uses `Mock<typeof obj.method>`, not an untyped `ReturnType<typeof spyOn>`.

### Exceptions

Enabling a currently-excluded rule (`prefer-readonly-parameter-types`) or re-enabling `require-await` requires updating this ADR with the specific trigger (e.g., `oxlint-tsgolint` shipping a `require-await`/`promise-function-async` reconciliation upstream) — not a silent config change.

## References

- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — minimal-dependency philosophy this ADR's tool choice follows
- [ARCH-017 — Multi-Ecosystem Distribution](./ARCH-017-multi-ecosystem-distribution.md) — establishes why `shims/**` is deliberately untyped and excluded here
- [ARCH-022 — AST-Aware Rule Context](./ARCH-022-ast-aware-rule-context.md) — this project's own AST-based rule engine; the dogfooding motivation for adopting the strongest available linter
- [oxlint type-aware linting docs](https://oxc.rs/docs/guide/usage/linter/type-aware.html)
- [tsgolint (GitHub)](https://github.com/oxc-project/tsgolint)
- [TypeScript 7 / typescript-go announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
