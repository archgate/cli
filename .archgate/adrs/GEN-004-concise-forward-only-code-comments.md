---
id: GEN-004
title: Concise, Forward-Only Code Comments
domain: general
rules: true
files:
  - "src/**/*.ts"
  - "tests/**/*.ts"
  - "lint/**/*.ts"
  - "scripts/**/*.ts"
  - "shims/**/*.ts"
  - ".archgate/lint/**/*.ts"
  - ".archgate/adrs/**/*.rules.ts"
---

# Concise, Forward-Only Code Comments

## Context

Code comments in this repository drift toward two failure modes, both produced disproportionately by AI agents narrating their own work:

1. **Historical narration**: comments describing what the code "used to" do or why an earlier approach was replaced (`// which used to add 3s of latency`). That information already lives in git history and in ADRs; embedded in code it becomes a changelog entry nobody maintains and that turns misleading after the next change.
2. **Oversized comment blocks**: multi-paragraph headers narrating an investigation, incident, or design discussion where 1-3 sentences on current behavior — plus a pointer to the ADR or memory file holding the full story — serve the reader better.

Stating the guideline only as agent-memory feedback binds a single memory-equipped agent, not humans or other tools. This repo's own experience (ARCH-019 with its companion rule, the custom oxlint plugins in `lint/`) shows conventions only stick once a check enforces them.

### Alternatives considered

1. **Agent memory / CLAUDE.md guidance only**: Rejected — unenforced guidance is exactly what lets a violation backlog accumulate.
2. **Companion `.rules.ts` heuristics only**: Rejected — portable and surfaced by `archgate check` / `archgate review-context`, but line-regex heuristics cannot distinguish comment tokens from string literals and miss block-comment interiors.
3. **Custom oxlint plugin rules only**: Rejected — real comment tokens via `sourceCode.getAllComments()` give precise spans and no string-literal false positives, but the rules are invisible to agents that only run `archgate check` and not portable to repos without this lint setup.
4. **Both layers (chosen)**: the oxlint rules are the precise, developer-facing check in `bun run lint`; the companion `.rules.ts` mirrors the same invariants in `archgate check`, where agent workflows and `review-context` briefings surface them. The redundancy is deliberate — each layer covers the other's blind spot.

This ADR also dogfoods the product: governance needs machine-checkable rules, and comment discipline is a governance concern both layers can demonstrate.

## Decision

Comments in all project-authored TypeScript MUST be concise and MUST describe current behavior only, never how it came to be.

### Conciseness

- A contiguous run of whole-line comments MUST carry **at most 5 lines of prose** — a ceiling, not an allowance (Compliance and Enforcement lists what counts toward a "run").
- Longer explanations belong in an ADR, agent-memory file, issue, or PR with a pointer; test code and fixtures meet the same bound.

### Structured documentation is exempt

The bound measures **narrative**: a doc comment's untagged summary only. A structural tag opens an exempt section — the tag line and every line under it, up to the next tag.

- **Exempt:** `@param`, `@arg`, `@typeParam`, `@template`, `@returns`, `@throws`, `@example`, `@see`, `@link`, `@defaultValue`, `@deprecated`, `@internal`, `@public`, `@alpha`, `@beta`, `@experimental`, `@module`, `@packageDocumentation`, `@typedef`, `@callback`, `@property`, `@overload`, `@inheritDoc`, `@label`.
- **NOT exempt:** `@remarks`, `@description`, `@summary`, `@notes`, `@todo`, `@fixme` — narrative in a tag's clothing, counted like untagged prose.

### Forward-only content

- Comments MUST NOT narrate history, relocations, or refactors — any phrasing about what changed rather than what the code does; the Don'ts below list flagged phrasings.
- **Agent memory is exempt** (`.claude/agent-memory/**`) by convention; neither requirement there is machine-checked.
- Present-tense location prose ("lives in") is description, not narration, and remains encouraged.
- When behavior changes, rewrite the comment to the new contract; never append "(update: now does Y)".

### Scope

Applies with no carve-outs to `src/`, `tests/`, `lint/`, `scripts/`, `shims/`, `.archgate/lint/`, `.archgate/adrs/**/*.rules.ts` (this ADR's `files` globs); Markdown, YAML, and JSON follow the same rule by prose only.

## Do's and Don'ts

### Do

- **DO** keep comment runs to 1-3 sentences — at most 5 prose lines — describing what the code currently does, never what it used to do.
- **DO** document parameters, returns, thrown errors, usage, and pointers with `@param`, `@returns`, `@throws`, `@example`, and `@see` (`@see ARCH-022`) instead of summary prose; tagged sections are exempt from the bound and reach IDE tooltips.
- **DO** write present-tense location pointers (`// Engine file listing is in-memory git-tracked matching, see ARCH-023`).
- **DO** move deep rationale (incidents, platform quirks) to an ADR or `.claude/agent-memory/` file, referenced by a one-line comment.
- **DO** rewrite a comment to the new contract when behavior changes; commits and PRs record why.
- **DO** treat any `no-narration-in-comments` or `oversized-comment-blocks` failure as a merge blocker.

### Don't

- **DON'T** write comments containing "used to X, now Y", "previously", "no longer", "originally", "an earlier version", "was tried", or `git blame` references; reword to present tense.
- **DON'T** narrate moves — "Extracted from `X`", "was migrated", "has been moved to `Y`", "split out of", "renamed from", "formerly known as" — even when the move explains why a module exists.
- **DON'T** replace a short comment with a block narrating the investigation behind it.
- **DON'T** park a violation behind `archgate-ignore` or `oxlint-disable`; suppression is for genuine false positives, with a stated reason.
- **DON'T** dissolve `@param`/`@returns`/`@throws`/`@example` tags into summary prose to fit the bound.
- **DON'T** relabel narrative as `@remarks`, `@description`, `@notes`, `@todo`, or `@fixme` to escape the budget.
- **DON'T** assume markdown, YAML, or JSON is exempt because the checks cover only TypeScript; the decision applies, enforced by manual review.
- **DON'T** treat "the check didn't flag it" as proof of compliance — narration can dodge every matched phrase, and a 5-line comment can still be padding.

## Consequences

### Positive

- **Lower reading cost:** Comments describe only the code in front of the reader.
- **No drift:** A comment describing only current behavior cannot contradict a previous state it never mentions.
- **Two-layer backstop:** Violations surface in `bun run lint` (IDE-visible, AST-precise) and in `archgate check` (agent-facing briefings) — neither humans nor agents can miss them.
- **Dogfooding:** Demonstrates archgate rules and custom lint rules covering one decision from both sides.
- **Deep context survives:** Rationale moves to ADRs and memory files where it is maintained, instead of decaying inline. `.claude/agent-memory/**` is exempt from the forward-only requirement specifically because its entries deliberately record past incidents — that is what makes "move deep rationale to an ADR or memory file" a real remedy rather than shifting the same violation elsewhere.
- **Pressure toward structured documentation:** Tagged sections cost nothing against the budget while summary prose does, so the cheapest way to keep a long doc comment is `@param`/`@returns`/`@throws`/`@example`. The bound nudges authors toward machine-readable TSDoc rather than away from documenting.

### Negative

- **Heuristic false positives block:** Both layers run at `error`, and "used to" matches purpose clauses ("is used to tailor error messages") as well as history. The remedy is rewording to present tense ("tailors error messages"), which is what this ADR wants anyway; genuine false positives take a reasoned `archgate-ignore` / `oxlint-disable-next-line`.
- **Heuristic false negatives:** The phrase lists are not semantic — narration that avoids them passes automatically and still needs a reviewer.
- **The 5-line bound is a proxy:** It counts lines, not sentences; terse padding fits under it. Reviewers catch emptiness; the rule catches size.
- **The tag exemption is syntactic:** Both layers trust the tag, so narrative parked under a structural tag — a `@see` followed by four paragraphs, or an `@example` whose "snippet" is prose — is exempted without being examined. Excluding prose containers closes the obvious door, not every door; reviewers verify a tagged section contains what its tag claims.

### Risks

- **A bound is a target** — prose will cluster at 5 lines. **Mitigation:** the limit is a ceiling, not an allowance; reviewers push back on 5-line comments that say nothing.
- **Pattern lists go stale** — new narration phrasing goes uncaught until someone extends the regexes. **Mitigation:** treat the lists as living; when a reviewer catches an unmatched pattern, extend both the oxlint rule and the companion `.rules.ts` in the same change, preferring grammar-based (past-tense/passive) patterns over vocabulary that also appears in encouraged location prose.
- **The two layers drift apart** — a pattern added to one but not the other silently narrows coverage. **Mitigation:** the shared patterns live in comments cross-referencing each other's file, and reviewers verify both files change together (see Manual enforcement).

## Compliance and Enforcement

### Automated enforcement

Two layers, same invariants, both `error` severity:

- **oxlint plugin rules** (`.archgate/lint/oxlint.ts`, run by `bun run lint`): `archgate/no-narration-in-comments` and `archgate/oversized-comment-blocks` operate on real comment tokens via `sourceCode.getAllComments()` — string literals never match, block-comment interiors always do. Both run repo-wide with no per-directory overrides in `.oxlintrc.json`.
- **Archgate rules** (companion `GEN-004-concise-forward-only-code-comments.rules.ts`, run by `archgate check`): `GEN-004/no-narration-in-comments` greps comment-looking lines for the narration and relocation patterns; `GEN-004/oversized-comment-blocks` counts prose lines in contiguous whole-line comment runs. These line-based heuristics carry one known, rare false positive — a match inside a string literal on a line starting with `//` — suppressible via `archgate-ignore` with a reason.
- **What keeps a run "contiguous" without adding to its count:** delimiters (`/**`, `*/`, bare `*`), dividers, SPDX headers (LEGAL-001), and tool directives (`oxlint-disable`, `@ts-expect-error`, `archgate-ignore`, and similar).

Both layers implement the structured-documentation exemption identically: a line opening a structural TSDoc tag, and every line under it up to the next tag, is skipped when counting prose; prose-container tags are counted. The two tag lists MUST stay in sync — they are the one piece of logic duplicated across the layers.

Both rules run at `error` against a codebase at zero violations. Any future tightening MUST bring the codebase to zero in the same change.

### Manual enforcement

Reviewers MUST verify on every PR touching project TypeScript:

1. New or modified comments describe current behavior only — no historical or relocation framing. The test is grammatical: subject = the _change_ ("was migrated") is narration; subject = the _code as it stands_ ("lives in") is description, and present-tense location prose of the latter form is encouraged, not flagged.
2. Comment runs stay within 5 prose lines, and longer rationale went to an ADR/memory file with a pointer.
3. Any suppression (`archgate-ignore`, `oxlint-disable`) carries a reason and marks a genuine false positive, not a parked violation.
4. Changes to the narration/relocation patterns touch both `.archgate/lint/oxlint.ts` and the companion `.rules.ts`.
5. Markdown/YAML/JSON prose follows the same rule even though no automated check covers it.

### Exceptions

- **Structured TSDoc sections**: exempt from the size bound as described in the Decision, never from the forward-only requirement — a `@param` line may not narrate history either.
- **`.claude/agent-memory/**`\*\*: exempt from the forward-only requirement, as described in Scope.
- **Suppressions**: genuine false positives only, always with a stated reason.
- **No directory-level exemptions**: there are no per-path carve-outs from either rule. Test files, fixtures, lint plugins, and the ADR companion rules files are all in scope, and any future exemption MUST be recorded here rather than added silently to `.oxlintrc.json`.

## References

- [ARCH-019: Interactive Prompts via withPromptFix](./ARCH-019-inquirer-prompt-fix.md) — the model this ADR generalizes: deep platform rationale lives in the ADR; call sites carry a one-line pointer
- [GEN-003: Tool Invocation via Package Scripts](./GEN-003-tool-invocation-via-scripts.md) — precedent for a GEN-domain decision enforced by companion rules
- [LEGAL-001: SPDX License Headers](./LEGAL-001-spdx-license-headers.md) — SPDX header lines are mandatory and do not count toward the prose bound
- [ARCH-005: Testing Standards](./ARCH-005-testing-standards.md) — governs the test files this ADR partially exempts
