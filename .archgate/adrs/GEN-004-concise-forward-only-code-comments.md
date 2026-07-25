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

Code comments in this repository have drifted toward two failure modes, both produced disproportionately by AI agents narrating their own work:

1. **Historical narration**: comments describing what the code "used to" do, what "previously" happened, or why an earlier approach was replaced (`// which used to add 3s of latency`, `* This used to be cached per process, but...`). The same information already lives in git history (commit messages, PR descriptions) and in ADRs; embedded in code it becomes a changelog entry that nobody maintains and that turns misleading after the next change.
2. **Oversized comment blocks**: multi-paragraph headers narrating an investigation, incident, or design discussion when 1-3 sentences describing current behavior — plus a pointer to the ADR or memory file that holds the full story — would serve the reader better. At the time this ADR was adopted, a repository-wide scan found 88 comment runs exceeding 5 lines of prose and 17 narration comments; all were fixed in the adopting change.

A repository-wide guideline existed only as agent-memory feedback ("comments must be concise"), which binds a single memory-equipped agent, not humans or other tools. This repo's own experience (ARCH-019 with its companion rule, the custom oxlint plugins in `lint/`) shows conventions only stick once a check enforces them.

### Alternatives considered

1. **Agent memory / CLAUDE.md guidance only (status quo)**: Rejected — unenforced guidance is exactly what allowed an 88-violation backlog to accumulate.
2. **Companion `.rules.ts` heuristics only**: Portable and surfaced by `archgate check` / `archgate review-context`, but line-regex heuristics cannot distinguish comment tokens from string literals and miss block-comment interiors.
3. **Custom oxlint plugin rules only**: Real comment tokens via `sourceCode.getAllComments()` (no string-literal false positives, precise spans, IDE-visible), but invisible to agents that only run `archgate check`, and not portable to repos that don't share this lint setup.
4. **Both layers (chosen)**: The oxlint rules are the precise, developer-facing check in `bun run lint`; the companion `.rules.ts` mirrors the same invariants in `archgate check`, where agent workflows and `review-context` briefings surface them. Redundancy is deliberate — each layer covers the other's blind spot.

For the Archgate CLI specifically, this ADR is also dogfooding: the product's premise is that governance needs machine-checkable rules, and comment discipline is a governance concern that both its enforcement layers can demonstrate.

## Decision

Comments in all project-authored TypeScript MUST be concise and MUST describe current behavior only, never the history of how that behavior came to be.

### Conciseness

- A contiguous run of whole-line comments MUST carry **at most 5 lines of prose**. The bound counts prose only: comment delimiters (`/**`, `*/`, a bare `*`), section dividers, SPDX headers (LEGAL-001), and tool directives (`oxlint-disable`, `@ts-expect-error`, `archgate-ignore`, and similar) keep a run contiguous but do not count.
- Longer explanations belong in a fuller reference — an ADR, agent-memory file, issue, or PR — with the comment pointing at it (`// See ARCH-019 for the Windows console-mode background`). Genuinely non-obvious, safety-critical invariants justify using the full 5 lines; nothing justifies exceeding them inline.

### Forward-only content

- Comments MUST NOT narrate history: no "used to X, now Y", "previously", "no longer", "originally", "an earlier version", "was tried", references to `git blame`, or similar phrasing describing what changed rather than what the code does.
- Comments MUST NOT narrate relocations or refactors: no "Extracted from `X`", "was migrated", "has been moved to `Y`", "split out of", "renamed from", "formerly known as". A move is an event in git history, not a property of the code.
- **Present-tense location prose is NOT narration and remains encouraged.** `// The single sanctioned meriyah call site is src/engine/js-parser.ts` describes current structure. The test is grammatical: if the sentence's subject is the _change_ ("was migrated", "Extracted from"), it is narration; if the subject is the _code as it stands_ ("lives in", "is defined in"), it is a description.
- When behavior changes, rewrite the comment to state the new contract — never append "(update: now does Y)" on top of the old text.

### Scope

Applies to all project-authored TypeScript: `src/`, `tests/`, `lint/`, `scripts/`, `shims/`, `.archgate/lint/`, and the ADR companion rules files (`.archgate/adrs/**/*.rules.ts`) — the code enforcing this decision is subject to it. Test files (`tests/**`) are exempt from the conciseness bound only (fixture-explaining blocks are common and low-risk there); the forward-only requirement still applies to them. `tests/fixtures/**` is fully exempt (fixture content is deliberately arbitrary). Markdown, YAML, and JSON are governed by this ADR's prose but not by the automated checks.

**Agent memory (`.claude/agent-memory/**`) is exempt from the forward-only requirement.** Those files exist to record incident history — a memory entry's `**Why:**` line is deliberately a past-tense account of the failure that produced the rule, and that account is what lets a future agent judge edge cases instead of following the rule blindly. Applying forward-only prose there would delete the very content the memory system is for. Conciseness still applies by convention (memory is loaded into every session's context), but neither requirement is machine-checked in that directory. This exemption is what makes "move deep rationale to an ADR or memory file" a real remedy rather than a redirection to a second place the rationale is banned.

## Do's and Don'ts

### Do

- **DO** keep comment runs to 1-3 sentences — at most 5 lines of prose.
- **DO** describe what the code currently does, not what it used to do or why an earlier approach was abandoned.
- **DO** write present-tense location pointers (`// Engine file listing is in-memory git-tracked matching, see ARCH-023`).
- **DO** move deep rationale (incidents, investigations, platform quirks) into an ADR or `.claude/agent-memory/` file and reference it from a one-line comment.
- **DO** rely on commit messages and PR descriptions to record why a change was made.
- **DO** rewrite a comment to the new contract when behavior changes.
- **DO** treat a `GEN-004/no-narration-in-comments`, `GEN-004/oversized-comment-blocks`, `archgate/no-narration-in-comments`, or `archgate/oversized-comment-blocks` failure as a merge blocker.

### Don't

- **DON'T** write comments containing "used to", "previously", "no longer", "originally", "an earlier version", "was tried", or references to `git blame` — reword to present tense (the reworded form is invariably clearer).
- **DON'T** narrate moves — "Extracted from X", "was migrated", "split out of", "renamed from" — even when the move explains why a module exists. Describe what the module _is_.
- **DON'T** replace a short comment with a multi-paragraph block narrating the investigation that led to the current code.
- **DON'T** park a violation behind `archgate-ignore` or `oxlint-disable` as a convenience — suppression is reserved for genuine false positives, with the reason stated in the suppression comment.
- **DON'T** assume markdown, YAML, or JSON files are exempt just because the automated checks cover only TypeScript — the decision applies; enforcement there is manual review.
- **DON'T** treat "the automated check didn't flag it" as proof of compliance — both layers are heuristic about _content_; a comment can narrate history without any matched phrase, and a 5-line comment can still be padding.

## Consequences

### Positive

- **Lower reading cost:** Comments describe only the code in front of the reader.
- **No drift:** A comment describing only current behavior cannot contradict a previous state it never mentions.
- **Two-layer backstop:** Violations surface in `bun run lint` (IDE-visible, AST-precise) and in `archgate check` (agent-facing briefings) — neither humans nor agents can miss them.
- **Dogfooding:** Demonstrates archgate rules and custom lint rules covering one decision from both sides.
- **Deep context survives:** Rationale moves to ADRs and memory files where it is maintained, instead of decaying inline.

### Negative

- **Heuristic false positives block:** Both layers run at `error`. Phrases like "used to" match purpose clauses ("is used to tailor error messages") as well as history. The remedy is rewording to present tense ("tailors error messages"), which is what this ADR wants anyway; genuine false positives can be suppressed with a reasoned `archgate-ignore` / `oxlint-disable-next-line` comment.
- **Heuristic false negatives:** The phrase lists are not semantic — narration that avoids the matched phrases passes automatically and still needs a reviewer.
- **The 5-line bound is a proxy:** It counts lines, not sentences; terse padding fits under it. Reviewers catch emptiness; the rule catches size.

### Risks

- **A bound is a target** — prose will cluster at 5 lines. **Mitigation:** the limit is a ceiling, not an allowance; reviewers push back on 5-line comments that say nothing.
- **Pattern lists go stale** — new narration phrasing won't be caught until someone extends the regexes. **Mitigation:** treat the lists as living; when a reviewer catches an unmatched pattern, extend both the oxlint rule and the companion `.rules.ts` in the same change, preferring grammar-based (past-tense/passive) patterns over vocabulary that also appears in encouraged location prose.
- **The two layers drift apart** — a pattern added to one but not the other silently narrows coverage. **Mitigation:** the shared patterns live in comments cross-referencing each other's file, and reviewers verify both files change together (see Manual enforcement).

## Compliance and Enforcement

### Automated enforcement

Two layers, same invariants, both `error` severity:

- **oxlint plugin rules** (`.archgate/lint/oxlint.ts`, run by `bun run lint`): `archgate/no-narration-in-comments` and `archgate/oversized-comment-blocks` operate on real comment tokens via `sourceCode.getAllComments()` — string literals never match, block-comment interiors always do. `.oxlintrc.json` disables the oversized rule for `tests/**` and both rules for `tests/fixtures/**`.
- **Archgate rules** (companion `GEN-004-concise-forward-only-code-comments.rules.ts`, run by `archgate check`): `GEN-004/no-narration-in-comments` greps comment-looking lines for the narration and relocation patterns; `GEN-004/oversized-comment-blocks` counts prose lines in contiguous whole-line comment runs. Line-based heuristics — a match inside a string literal that starts a line with `//` is a known (rare) false positive, suppressible via `archgate-ignore` with a reason.

Both launched at `error` with the 88-block / 17-comment backlog fixed in the adopting change. Any future tightening MUST bring the codebase to zero in the same change.

### Manual enforcement

Reviewers MUST verify on every PR touching project TypeScript:

1. New or modified comments describe current behavior only — no historical or relocation framing.
2. Comment runs stay within 5 prose lines, and longer rationale went to an ADR/memory file with a pointer.
3. Any suppression (`archgate-ignore`, `oxlint-disable`) carries a reason and marks a genuine false positive, not a parked violation.
4. Changes to the narration/relocation patterns touch both `.archgate/lint/oxlint.ts` and the companion `.rules.ts`.
5. Markdown/YAML/JSON prose follows the same rule even though no automated check covers it.

### Exceptions

- **`tests/**`\*\*: exempt from the 5-line bound (not from forward-only content).
- **`tests/fixtures/**`\*\*: fully exempt — fixture content is arbitrary by design.
- **Suppressions**: genuine false positives only, always with a stated reason.

## References

- [ARCH-019: Interactive Prompts via withPromptFix](./ARCH-019-inquirer-prompt-fix.md) — the model this ADR generalizes: deep platform rationale lives in the ADR; call sites carry a one-line pointer
- [GEN-003: Tool Invocation via Package Scripts](./GEN-003-tool-invocation-via-scripts.md) — precedent for a GEN-domain decision enforced by companion rules
- [LEGAL-001: SPDX License Headers](./LEGAL-001-spdx-license-headers.md) — SPDX header lines are mandatory and do not count toward the prose bound
- [ARCH-005: Testing Standards](./ARCH-005-testing-standards.md) — governs the test files this ADR partially exempts
