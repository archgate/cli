---
id: ARCH-026
title: Strict Mode and Check Severity Tiers
domain: architecture
rules: false
files:
  - "src/engine/reporter.ts"
  - "src/commands/check.ts"
  - "src/commands/review-context.ts"
  - "src/engine/context.ts"
  - "src/commands/adr/sync.ts"
  - "src/helpers/project-config.ts"
  - "src/formats/project-config.ts"
---

## Context

`archgate check` reports findings at three distinct severities (`error`, `warning`, `info`) plus a set of diagnostics that are structurally similar to warnings but were never counted toward `pass`: `briefingWarnings` (an ADR's "Decision" or "Do's and Don'ts" section exceeds the `review-context` briefing budget — see [ARCH-003 §5's briefing truncation](./ARCH-003-output-formatting.md)), `suppressionWarnings` (missing-reason or unused `archgate-ignore` comments), and `unparsedAdrs` (an ADR file that failed to parse and was silently excluded from every other check). A count-based `--max-warnings <n>` flag previously gated the first category (rule-severity `warning` violations) but had no way to reach the other three — they were hard-coded as advisory in `reporter.ts`'s `buildSummary()`, with a comment stating they "never affect `pass`." That flag was removed when `--strict` shipped (see Decision).

This split was deliberate, not an oversight: an ADR whose "Do's and Don'ts" cannot shrink below the briefing cap without losing a normative clause is _expected_ to exceed it, so failing a local `check` run on that basis by default would punish authors for writing complete governance text. The same reasoning applies to a single unused suppression comment during active development. But the same reasoning does not hold in CI, where the project may want zero tolerance: an ADR corpus that silently grows briefing overruns, stale suppressions, or unparseable files is a governance quality regression that nothing currently catches, because `check`'s own exit code stays 0 regardless.

This is the same class of problem linters solve with a "warnings as errors" mode: loose during local iteration, strict at the CI gate. ESLint's `--max-warnings 0` and Rust's `-D warnings` are both single-flag escalations of an existing severity model, not a redesign of it. Two categories of "warning" exist in this codebase, and only one fits that model:

1. **Structured governance diagnostics** — the four categories above, shared between `check` and `review-context` (which reuses `buildSummary()` under `--run-checks`, and independently tracks `truncatedBriefings` when briefings are requested via `--verbose`). These are typed, counted, and already flow through `ReportSummary`.
2. **Ad-hoc operational messages** — bare `logWarn()` calls in `src/commands/init.ts`, `src/commands/plugin/install.ts`, and `src/helpers/credential-store.ts` (e.g. "Copilot CLI not found, install manually", git-credential-helper quirks). These have no counting or severity model and are not governance findings — they describe the state of the local machine during an install/login flow, not a defect in the ADR corpus.

`archgate adr sync` carries a related but distinct concept: `result.errors`, incremented when an imported ADR's source can't be resolved, its upstream repo can't be cloned, or its local/upstream file is missing. These are genuine ADR-corpus integrity problems — the same spirit as the advisory categories above — but they are a separate counter on a separate command, not one of the four `ReportSummary` fields, and `sync` already has an unrelated `--check` flag (exit 1 when upstream has drifted) that must not be conflated with error-tolerance.

**Alternatives considered:**

- **Redefine `--max-warnings` to sum all four categories into one count.** Rejected: collapsing unrelated diagnostics (a rule warning vs. an unparseable ADR file) into one number loses the ability to say _why_ a run failed.
- **Keep `--max-warnings <n>` alongside `--strict`.** Rejected: two overlapping escalation knobs require a precedence rule between them ("explicit threshold wins") that every user must learn, for a tolerate-exactly-N budget with no demonstrated use case. `--strict` covers the real scenario — zero tolerance at the CI gate — so the count-based flag was removed in the same breaking release that unified `check`'s output flags under `--output`.
- **One flag per advisory category** (`--fail-on-briefing-warnings`, `--fail-on-suppression-warnings`, `--fail-on-unparsed-adrs`). Rejected as disproportionate: it multiplies flags and documentation for a "loose in dev, strict in CI" toggle that is conceptually one on/off switch in every linter that offers it.
- **Scope the new flag to every `logWarn()` call site in the CLI**, including `init`/`plugin install`/`credential-store`. Rejected: those sites have no counting or severity model to hook into, and are not quality findings about the governed project — see Decision's Scope subsection.

## Decision

`archgate check`, `archgate review-context`, and `archgate adr sync` MUST support a blanket `--strict` boolean flag that escalates otherwise-advisory diagnostics into command failures (exit 1), on top of each command's existing severity model. `--strict` MUST resolve CLI flag first, else a `strict: boolean` key in `.archgate/config.json` (via `getConfiguredStrict()`, mirroring `baseBranch`), else `false`.

**Scope:** the four `ReportSummary` categories (rule-severity `warning`, `briefingWarnings`, `suppressionWarnings`, `unparsedAdrs`) and `adr sync`'s `result.errors`. NOT the ad-hoc `logWarn()` sites in `init.ts`, `plugin/install.ts`, `credential-store.ts` — those describe local-machine state, not ADR-corpus quality.

`check`'s former `--max-warnings <n>` flag is REMOVED (breaking): `--strict` is the single escalation switch; no tolerate-up-to-N budget is offered.

**Per-command semantics:**

- **`check`** (`buildSummary()`): any rule-severity `warning` sets `warningsExceeded`. Sets `strictAdvisoryExceeded` when `briefingWarnings`, `suppressionWarnings`, or `unparsedAdrs` is non-empty; either flips `pass` to `false`. The ADR-corpus diagnostics (`briefingWarnings`, `unparsedAdrs`) MUST be collected on every exit path, including the zero-rules early return, so a prose-only or unparseable corpus still fails under `--strict`; `suppressionWarnings` are violation-scoped and exist only when rules run.
- **`review-context`**: fails when `truncatedBriefings` is non-empty, or, with `--run-checks`, when `checkSummary.warningsExceeded`/`strictAdvisoryExceeded` is true. Does NOT gate on `checkSummary.failed`/`ruleErrors` — it stays a context generator; `check` alone gates rule violations.
- **`adr sync`**: fails when `result.errors > 0`, composable with `--check`'s own exit-1 condition (`withChanges > 0`).

**Capabilities:** one flag and precedence across all three commands; composes with existing per-command controls; config-persistable so CI need not pass the flag each run.

## Do's and Don'ts

### Do

- **DO** resolve `strict` as `opts.strict ?? getConfiguredStrict(projectRoot) ?? false` in every command that supports it.
- **DO** collect the ADR-corpus diagnostics (briefing budget, unparsed ADRs) on every `check` exit path, including the zero-rules early return (`collectBriefingDiagnostics()`).
- **DO** compute `strict`-driven pass/fail logic once, inside `reporter.ts`'s `buildSummary()`/`getExitCode()`, and have every caller consume `strictAdvisoryExceeded` rather than re-deriving the condition.
- **DO** print the full result payload before exiting non-zero under `--strict` — a piped consumer must still see what was found, not just the failure.
- **DO** extend `--strict` to a new advisory-style diagnostic via the `strictAdvisoryExceeded` computation in `buildSummary()`, not a parallel condition elsewhere.
- **DO** log a clear, `--strict`-attributed message (via `logWarn()`) naming which finding(s) caused the failure, before calling `exitWith(1)`.
- **DO** treat `adr sync`'s `result.errors` as the sync-specific analogue of the advisory categories, kept as its own counter rather than folded into `ReportSummary`.

### Don't

- **DON'T** add `--strict` to `init`, `plugin install`, or `credential-store` output — those `logWarn()` calls are operational, not governance findings.
- **DON'T** reintroduce a count-based warning threshold without a new ADR — `--strict` is deliberately binary.
- **DON'T** gate `review-context --strict` on `checkSummary.failed`/`ruleErrors` — that turns a context generator into a second compliance gate; `check` alone is responsible for rule violations.
- **DON'T** introduce a `--no-strict` negation flag without a matching need — no boolean flag here ships a negation, and `strict` already has three resolution states without one.
- **DON'T** drop an advisory finding from the payload when `--strict` is off — advisory categories MUST still surface; only pass/fail and exit code change with `--strict`.

## Consequences

### Positive

- **CI can enforce zero-tolerance without changing local dev ergonomics**: a project sets `strict: true` in `.archgate/config.json` (or passes `--strict` in its CI job) while local `archgate check` runs stay lenient by default.
- **One mental model across three commands**: contributors learn `--strict` once; its precedence and general "escalate advisories" meaning transfers between `check`, `review-context`, and `adr sync` without per-command relearning.
- **One escalation switch, no precedence rules**: with the count-based threshold gone, "does this run pass" depends only on severities and whether `strict` is active — nothing to compose, nothing to mis-order.
- **Advisory categories stay genuinely advisory by default**: an ADR author hitting the briefing-budget cap locally is not blocked unless the project has opted into `--strict`, preserving the original rationale for treating these as non-blocking.

### Negative

- **Lost warning-budget granularity**: the removed `--max-warnings <n>` allowed tolerating up to N warnings while failing on N+1; `--strict` is all-or-nothing. A project wanting a gradual warning budget must derive it from `--output json`'s `warnings` count in its own pipeline, and removing the flag breaks any CI invocation still passing it.
- **Two severity axes to reason about**: reviewers and contributors now must track both "does this violation have `severity: error`" and "is `--strict` active" to predict whether a given run passes — more surface area than a single severity field.
- **`review-context`'s scope boundary (not gating on rule violations) is a subtle, easy-to-miss distinction** from `check`'s full-gate behavior; a contributor extending `--strict` there without reading this ADR could accidentally widen it into a second compliance gate.
- **`adr sync`'s `result.errors` uses the same `--strict` flag name but a different underlying condition** than `check`/`review-context`'s advisory categories — consistent naming, inconsistent mechanism, which this ADR mitigates only by documentation, not by shared code.

### Risks

- **New advisory-style diagnostics added to `check` later may be forgotten in the `strictAdvisoryExceeded` computation**, silently staying non-blocking under `--strict` when the author intended otherwise.
  - **Mitigation:** the Do's and Don'ts above prescribe extending `strictAdvisoryExceeded` in `buildSummary()` as the single point of change; code review MUST check any new `ReportSummary` array field against this ADR.
- **A project enabling `strict: true` in `.archgate/config.json` may be surprised when a previously-passing `check` run starts failing in CI**, since the config default applies with no flag on the command line.
  - **Mitigation:** `getConfiguredStrict()` only takes effect when the CLI flag is omitted entirely, matching the pre-existing `baseBranch` precedent; the change is opt-in (the key must be explicitly added) and each command's `--strict`-driven failure logs which finding(s) caused it.
- **No automated rule currently checks that a command claiming to read `ReportSummary`'s advisory fields also reads `strictAdvisoryExceeded`** — this ADR documents a convention, not a mechanically-enforced invariant.
  - **Mitigation:** tracked as future work below; until an `archgate` rule exists, code review is the enforcement layer for this specific risk.

## Compliance and Enforcement

### Automated Enforcement

- **Not yet implemented.** No `archgate` rule currently verifies that a command consuming `ReportSummary`'s advisory arrays also branches on `strictAdvisoryExceeded`, or that `--strict`/config-precedence resolution matches the `opts.strict ?? getConfiguredStrict(projectRoot) ?? false` pattern. A companion `.rules.ts` could be added later if this drifts in practice — this ADR's `rules: false` reflects that no such rule exists yet.
- `bun test` covers the behavior directly: `tests/engine/reporter-strict.test.ts` (severity-tier composition), `tests/integration/check-strict.test.ts`, `tests/integration/review-context-strict.test.ts`, and `tests/commands/adr/sync-strict.test.ts` (per-command gating, config precedence, non-regression of the advisory-never-blocks-by-default baseline).

### Manual Enforcement

Code reviewers MUST verify:

1. Any new `ReportSummary` field intended as an advisory (non-blocking-by-default) diagnostic is added to the `strictAdvisoryExceeded` computation in `buildSummary()`, not left out.
2. A new command supporting `--strict` resolves it via the `opts.strict ?? getConfiguredStrict(projectRoot) ?? false` precedence, not a bespoke resolution.
3. `review-context --strict` changes do not begin gating on ordinary rule violations (`checkSummary.failed`/`ruleErrors`) without a new ADR decision reversing that scope boundary.
4. A `--strict`-driven failure logs an explanatory message before exiting non-zero.
5. Any new `check` exit path that returns before `runChecks()` still collects the ADR-corpus diagnostics (`collectBriefingDiagnostics()`), so `--strict` cannot be blinded by an early return.

### Exceptions

None currently approved. A command with a genuine reason to interpret `--strict` differently from the precedence/scope rules above requires a new ADR (or an amendment to this one), approved the same way as any other governance change.

## References

- [ARCH-002 — Error Handling](./ARCH-002-error-handling.md) — defines the exit-code model (`0`/`1`/`2`/`130`) this ADR's `--strict`-driven `exitWith(1)` calls follow.
- [ARCH-003 — Output Formatting](./ARCH-003-output-formatting.md) — defines the `--json`/agent-context output conventions `strictAdvisoryExceeded` flows through, and is the source of the briefing-truncation behavior `briefingWarnings` reports on.
- [ESLint `--max-warnings`](https://eslint.org/docs/latest/use/command-line-interface#--max-warnings) — precedent for the warnings-as-errors escalation model; archgate shipped and then removed its own count-based threshold in favor of the single `--strict` switch.
