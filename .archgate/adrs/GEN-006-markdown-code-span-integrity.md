---
id: GEN-006
title: Markdown Code Span Integrity
domain: general
rules: true
files: ["**/*.md", "**/*.mdx"]
---

# Markdown Code Span Integrity

## Context

CommonMark gives backslash escapes no meaning inside an inline code span. [Section 6.1](https://spec.commonmark.org/0.31.2/#backslash-escapes) states that backslash escapes do not work in code spans, and [section 6.3](https://spec.commonmark.org/0.31.2/#code-spans) defines a span as ending at the next backtick string of equal length — a rule with no escape hatch. Writing a backslash before a backtick to keep it inside a span therefore does the opposite of what it looks like:

```text
`UserError("Run \`archgate init\` first")`
```

That line contains four backticks, not two. The first pairs with the one after `Run \`, closing a span whose content ends in a literal backslash. `archgate init\` falls out into prose. The third and fourth backticks open and close a second span around ` first")`. Every delimiter after the first escape re-pairs one position out, so the damage runs to the end of the line rather than staying local to the snippet.

This is invisible to the tools already in the pipeline. `format:check` compares a file against its own re-print, and a file containing this text is already in normal form, so the stage passes. `oxlint` and `tsc` never open markdown. The output is valid markdown that renders wrongly, not malformed markdown that fails to parse — nothing downstream has a reason to object. The cost lands on readers of the docs site, and on agents consuming ADR briefings, where a mangled span reads as prose.

Two properties make this worth a rule rather than a convention. It is purely lexical, needing no cooperation from any formatter and no network or AST access. And it is asymmetric: authors reach for the escape precisely when a snippet contains a backtick, which is when the correct spelling — a longer delimiter — is least familiar.

### Alternatives considered

1. **Rely on the formatter** — Rejected. A formatter that preserves the bytes is behaving correctly; the text is well-formed markdown. Any release that changed this behaviour would be changing it in a version-specific way, leaving the invariant unenforced on every other version.
2. **Flag every backslash-backtick sequence in a file** — Rejected: it cannot tell a mistaken escape from a code span whose content legitimately ends in a backslash, which a Windows path routinely does (see the opencode integration guide's `.config` paths). A rule that fires on correct prose is a rule contributors learn to suppress.
3. **Parse each file with a full CommonMark implementation and compare rendered output** — Rejected under [ARCH-006](./ARCH-006-dependency-policy.md): it adds a parser dependency to detect a single-character defect that a line-oriented scan already isolates exactly.
4. **A companion `.rules.ts` that walks code-span delimiters per line** (chosen) — Matches the idiom [ARCH-021](./ARCH-021-ascii-only-powershell-scripts.md) and [GEN-002](./GEN-002-docs-i18n.md) already use for text-corruption checks: scan the bytes, report the line, name the fix.

## Decision

Markdown and MDX files MUST NOT contain a backslash-escaped backtick in text content. The escape does not do what its author intends, so the correct spelling is always one of two things:

- **A longer delimiter.** A code span may be delimited by any number of backticks, and a run of _n_ backticks ends only at the next run of exactly _n_. Two backticks around a snippet containing single backticks needs no escape at all. When the content itself begins or ends with a backtick, pad with one space on each side; CommonMark strips a single leading and trailing space when both are present.
- **A restructured sentence,** where the inner command sits in a span of its own and the surrounding message is plain prose.

**Scope.** The invariant is checked on text content only. A backslash immediately before a backtick is legitimate, and is not reported, in three places: inside a code span, where the backslash is literal content; inside a fenced code block, where the whole region is literal; and inside YAML frontmatter, which is not rendered as markdown. A backslash that escapes another backslash consumes it, so a literal backslash preceding a span opener is also not a violation.

**Exemption.** `CHANGELOG.md` is generated from commit messages and rewritten on every release. It is excluded, matching the `ignorePatterns` entry it already has in `.oxfmtrc.json`.

## Do's and Don'ts

### Do

- **DO** wrap a snippet containing backticks in a longer delimiter, as in ``` ``await Bun.$`git ls-files`.text()`` ``` — two backticks outside, single backticks untouched inside.
- **DO** pad with one space on each side when the span's content starts or ends with a backtick, so the delimiter stays unambiguous and the space is stripped on render.
- **DO** split a sentence instead, when a longer delimiter would be hard to read: give the inner command its own span and write the surrounding message as prose.
- **DO** treat a `GEN-006/no-escaped-backtick-in-markdown` violation as a rendering defect on the line it names — the reported column is the backslash to delete, and the mispairing it causes continues to end of line.
- **DO** put illustrative examples of the broken form inside a fenced code block when documenting this decision, which is where the rule intentionally does not look.

### Don't

- **DON'T** write a backslash before a backtick to keep it inside a code span. CommonMark ignores the backslash, so the span closes there and the backslash renders as itself.
- **DON'T** re-add the spaces by hand when a line's spans look mispaired, and assume the source is now correct — the delimiters are still wrong and the next reader inherits the same text.
- **DON'T** suppress this rule for a Windows path or any other span whose content genuinely ends in a backslash; the rule does not report those, so a violation on such a line means the delimiters really are unbalanced.
- **DON'T** extend the generated-file exemption beyond files that are rewritten wholesale by tooling — a hand-edited file that merely happens to be long is still authored content.

## Consequences

### Positive

- **A rendering defect becomes a build failure.** The class of corruption that no other stage can see is now caught by `archgate check` on the same run that would have shipped it.
- **No dependency added.** The check is a line scan over files the engine already lists, so it costs one read per markdown file and no parser.
- **Precise by construction.** Because it walks span delimiters rather than grepping for a byte pair, it distinguishes a mistaken escape from a Windows path ending in a backslash — the case that makes the naive check unusable in this repository.
- **The fix is stated in the violation.** The `fix` field names the longer-delimiter spelling, so the correction does not require reading the CommonMark spec.

### Negative

- **Line-scoped, not document-scoped.** Code spans may span lines in CommonMark; this check resets at each newline. A span opened on one line and closed on the next is treated as unclosed, which can only cause a missed report, never a false one.
- **Generated changelog content is unguarded.** A commit message containing an escaped backtick reaches `CHANGELOG.md` unchecked, and renders wrongly on GitHub and npm.
- **One report per line.** A line with several escaped backticks is reported at the first; the rest surface on the next run after the first is fixed.

### Risks

- **MDX expression syntax.** A template literal inside an MDX `{...}` expression is JavaScript, not markdown, and its backticks are not code-span delimiters. No page in this repository uses one, so the residual is theoretical. **Mitigation**: should such a page appear, the fix is to teach the scanner about MDX expressions, not to weaken the text-content check.
- **Fence tracking is toggle-based.** A file whose fences are themselves unbalanced desynchronises the in-fence flag for the remainder of the document. **Mitigation**: an unbalanced fence is itself a rendering defect that is visible on the docs site, and it can only suppress reports, never invent them.

## Compliance and Enforcement

**Automated enforcement** (companion `GEN-006-markdown-code-span-integrity.rules.ts`):

- **GEN-006/no-escaped-backtick-in-markdown**: Reads every file in `scopedFiles` ending in `.md` or `.mdx`, skipping YAML frontmatter and fenced code blocks, and walks each remaining line over its code-span delimiters. Reports a violation for the first backslash-escaped backtick found in text content on a line, naming the backslash's column and the longer-delimiter fix. Severity: error.

**Manual enforcement**: Reviewers MUST read a changed markdown line's spans as CommonMark pairs them, not as the author appears to have intended, whenever a line mixes prose and backticks. A snippet that itself contains a backtick is the signal to check the delimiter length.

**Exceptions**: `CHANGELOG.md` only, on the generated-file grounds stated in Decision. Any further exemption requires amending this ADR's Decision section rather than extending the rule's exclusion set.

## References

- [archgate/cli#515](https://github.com/archgate/cli/issues/515) — this ADR's originating issue
- [CommonMark 0.31.2 §6.1 Backslash escapes](https://spec.commonmark.org/0.31.2/#backslash-escapes) — backslash escapes do not work in code spans
- [CommonMark 0.31.2 §6.3 Code spans](https://spec.commonmark.org/0.31.2/#code-spans) — a span ends at the next backtick string of equal length
- [ARCH-021: ASCII-Only PowerShell Scripts](./ARCH-021-ascii-only-powershell-scripts.md) — the closest idiom: a lexical scan for a character-level corruption a formatter cannot see
- [GEN-002: Docs i18n](./GEN-002-docs-i18n.md) — the sibling text-corruption check, scoped to encoding rather than delimiters
- [ARCH-006: Dependency Policy](./ARCH-006-dependency-policy.md) — why the check scans bytes instead of adding a CommonMark parser
