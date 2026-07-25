---
id: GEN-005
title: ADR Briefing Budget
domain: general
rules: true
files:
  - ".archgate/adrs/**/*.md"
---

## Context

`archgate review-context --verbose` is how an agent learns which ADRs govern the files it is changing. It does not embed the whole ADR: `briefAdr` in `src/engine/context.ts` extracts exactly two sections — `Decision` and `Do's and Don'ts` — and truncates each at `DEFAULT_MAX_SECTION_CHARS`. Prose past that point is replaced by a marker and never reaches the agent.

That makes section length a correctness property, not a style preference. An ADR whose `Decision` runs several times the cap has most of its rules silently excluded from the briefing that exists to deliver them, and the ADR reads as fully enforced because `archgate check` still passes — its companion rules are unaffected by prose length.

The failure is asymmetric in a way that rewards the wrong instinct: the most consequential ADRs attract the most prose, so the decisions most worth briefing are the ones most likely to be cut. Truncation always removes the _end_ of a section, so whatever an author wrote last is lost first.

### Alternatives considered

1. **Raise the cap until every ADR fits**: Rejected — the cap exists because verbose prose dominates the payload, and a large enough payload stops being displayed inline by agent harnesses at all. Trading silent truncation for silent non-display is not a fix.
2. **Truncate with no signal (status quo before this ADR)**: Rejected — a consumer cannot distinguish a short section from a cut one, so incomplete governance reads as complete.
3. **Block oversized sections at `error` severity**: Rejected — some ADRs cannot comply. A section that is an enumeration of normative identifiers (banned globals, ordered guardrails, license lists) has an irreducible floor above the cap, and an unfixable blocking rule trains authors to suppress it.
4. **Warn at authoring time and report at consumption time (chosen)**: The author is told before merge, the consumer is told when context is actually missing, and neither is blocked.

## Decision

The two sections consumed by briefings — `Decision` and `Do's and Don'ts` — MUST be written to fit within `DEFAULT_MAX_SECTION_CHARS`, and an ADR that exceeds it MUST do so deliberately.

Authors MUST apply these remedies, in order, before accepting truncation:

1. Remove historical narration and drift-prone literals (GEN-004).
2. Move rationale, incidents, and worked examples to `Context`, `Consequences`, or a memory file — those sections are never briefed, so length there costs nothing.
3. Merge Do/Don't items that state the same rule twice.
4. Front-load the section so its most normative content precedes any possible cut.

Exceeding the budget is permitted **only** when the next cut would remove a normative clause — a MUST/MUST NOT, a named guardrail, an exemption, an exit code, or an enumerated identifier list. Length alone is never sufficient justification.

An ADR that legitimately exceeds the budget MUST state so in its `Compliance and Enforcement` section, naming what cannot be cut. This converts an invisible overflow into a reviewed decision.

Section headings MUST remain exactly `## Decision` and `## Do's and Don'ts`. The extractor matches them as literal strings; renaming one silently empties the briefing rather than failing.

## Do's and Don'ts

### Do

- **DO** keep `Decision` and `Do's and Don'ts` within the briefing budget — treat the cap as a ceiling, not an allowance.
- **DO** put rationale, alternatives, incidents, and long examples in `Context` or `Consequences`, which are never briefed.
- **DO** front-load normative content so the most important rules survive a cut.
- **DO** record a deliberate overflow in `Compliance and Enforcement`, naming the specific clauses that cannot be removed.
- **DO** keep the two briefed heading names byte-exact, including the apostrophe in `Do's and Don'ts`.
- **DO** treat a `GEN-005/briefing-budget` warning as a prompt to re-read the section for narration before assuming it is irreducible.
- **DO** re-run `archgate review-context --verbose` after trimming an ADR to confirm it dropped off the truncation warning.

### Don't

- **DON'T** delete a normative clause to fit the budget — semantics outrank size, and a deliberate overflow is the sanctioned outcome.
- **DON'T** move prose out of `Decision` into `Do's and Don'ts` (or the reverse) to dodge the check — both sections are briefed and both are capped.
- **DON'T** rename, reorder, or reword the two briefed headings.
- **DON'T** assume a passing `archgate check` means an ADR briefs completely — companion rules do not measure prose.
- **DON'T** suppress the rule as a convenience; suppression is for a documented, irreducible section.
- **DON'T** raise `DEFAULT_MAX_SECTION_CHARS` to silence a single oversized ADR — the cap is a payload-wide budget.

## Consequences

### Positive

- **Governance actually reaches the agent:** rules inside the budget are delivered rather than cut.
- **Overflow becomes a decision:** an ADR over budget is reviewed and justified instead of silently degraded.
- **Authoring feedback is early:** authors learn at `archgate check` time, not when an agent misses a rule.
- **Pressure toward the right structure:** length is free in un-briefed sections, so rationale migrates there naturally.
- **Complements the runtime signal:** the author-side warning and the `review-context` warning cover authoring and consumption.
- **Dogfooding:** the repository's own ADR corpus is measured by a rule the product ships.

### Negative

- **The cap is a proxy for value, not a measure of it:** a section can fit the budget and still be vague.
- **Character counts ignore structure:** a dense identifier list and an equal length of padding are indistinguishable to the rule.
- **Split incentive:** moving prose to `Context` improves the briefing without improving the ADR, so a reviewer must still judge whether the relocated text belongs there at all.

### Risks

- **Authors delete normative content to clear the warning.** **Mitigation:** the rule is `warning` severity and never blocks, its message states that deliberate overflow is permitted, and the Don'ts name content deletion as the wrong remedy.
- **The rule's cap drifts from the engine's constant.** **Mitigation:** the companion rule reads `DEFAULT_MAX_SECTION_CHARS` from `src/engine/context.ts` when that file is present and falls back to the documented default otherwise, so the two cannot silently disagree in this repository.
- **Warnings accumulate and stop being read.** **Mitigation:** legitimate overflows are documented in the ADR's own `Compliance and Enforcement`, so a reviewer can distinguish a known, justified warning from a new one.

## Compliance and Enforcement

### Automated enforcement

- **Archgate rule** `GEN-005/briefing-budget` (companion `GEN-005-adr-briefing-budget.rules.ts`): measures the `Decision` and `Do's and Don'ts` sections of every ADR using the same extraction logic as `briefAdr`, and reports a warning naming the section, its size, and the overflow. Severity `warning` — it reports a documentation-quality problem, and the sanctioned outcome for an irreducible section is to exceed the budget knowingly.

### Manual enforcement

Reviewers MUST verify on every PR that adds or edits an ADR:

1. New prose in `Decision` or `Do's and Don'ts` is normative, not rationale that belongs in `Context`.
2. A new or newly-worsened budget warning is either fixed or justified in that ADR's `Compliance and Enforcement`.
3. The two briefed heading names are unchanged.

### Exceptions

- **Documented irreducible sections**: an ADR whose briefed section cannot shrink without losing a normative clause exceeds the budget and records why. ARCH-024 and ARCH-022 are the standing examples — both enumerate security-critical identifiers whose omission would change what the ADR governs.
- **This ADR is within budget** and carries no exception.

## References

- [GEN-004: Concise, Forward-Only Code Comments](./GEN-004-concise-forward-only-code-comments.md) — the prose discipline this ADR applies to ADR markdown
- [ARCH-003: Output Formatting](./ARCH-003-output-formatting.md) — §7 progressive disclosure, the reason briefing payloads are capped at all
- [ARCH-024: Rule File Sandbox Boundary](./ARCH-024-rule-file-sandbox-boundary.md) — a standing documented overflow
- [ARCH-022: AST-Aware Rule Context](./ARCH-022-ast-aware-rule-context.md) — a standing documented overflow
