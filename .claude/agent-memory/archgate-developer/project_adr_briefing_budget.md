---
name: adr-briefing-budget
description: Measuring an ADR section against the 2000-char briefing cap, and why review-context needs --verbose to return any prose at all
metadata:
  type: project
---

## Measuring a section against the cap

`archgate review-context --verbose`'s `decision`/`dosAndDonts` fields are **already truncated** to the cap plus a fixed-length `[... truncated ...]` marker. Measuring `.length` on them returns a constant whenever the raw content is still over, masking whether a trim actually helped.

Measure the real raw length via `bun run cli check --output json`'s `briefingWarnings[].length` field instead — present only when over budget, absent once trimmed enough.

For headroom accounting **before** editing a near-cap section, measure raw lengths directly with `bun -e`, importing `extractAdrSections` + `BRIEFED_SECTIONS` from `./src/engine/adr-sections` (cap constant: `DEFAULT_MAX_SECTION_CHARS`, 2000). Note `extractAdrSections(body, sectionNames)` takes the section list as its second argument.

Several ADRs sit within single-digit characters of the cap, so an edit there must be planned as a character-for-character replacement. **This repo runs strict**, so an over-budget section fails the build rather than warning it.

When a section has no headroom for content that genuinely belongs to the ADR: put the normative sentence in Do's and Don'ts — also briefed, and usually where a rule reads best anyway — and the explanatory detail in Context, which is neither briefed nor capped.

## review-context returns no prose by default

`review-context` omits every ADR's `decision`/`dosAndDonts` **by default**. The `@reviewer` skill's own instructions describe the briefing as containing "only the Decision and Do's and Don'ts sections," but the CLI's actual default leaves both fields off; only `--verbose` includes them. Without it, per-domain sub-agent prompts built from the response carry `id`/`title`/`domain` and nothing to check code against.

Always run `bun run cli review-context --verbose` (per-domain, via `--domain <name>`, to keep each call small) when gathering context for reviewer sub-agent prompts.

Capturing its output: JSON is the only format it emits — it has no `--output` flag, unlike `check` — and `bun run` prints its `$ <command>` banner to **stderr**, so `2>/dev/null > file` is the whole redirect. Piping through `tail -n +2` to strip the banner instead yields an empty file, because the JSON is a single line.
