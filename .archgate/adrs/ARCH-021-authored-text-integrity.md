---
id: ARCH-021
title: Authored Text Integrity
domain: architecture
rules: true
files: ["**/*.ps1", "**/*.md", "**/*.mdx"]
---

# Authored Text Integrity

## Context

Some defects are not in what a file means but in what its bytes decode to. They share a shape: the file is syntactically valid, every stage of `bun run validate` passes, the text looks correct in the author's editor, and the damage appears only in a reader the author was not using. Two live in this repository.

**PowerShell decoding.** Archgate distributes a Windows installer, `install.ps1`, fetched and executed with `irm ... | iex`. The file is saved without a UTF-8 byte-order mark, and **Windows PowerShell 5.1** — still the default shell on a large share of Windows machines — decodes a BOM-less `.ps1` using the system codepage, typically Windows-1252, not UTF-8. Any multi-byte UTF-8 character is then mis-decoded: an em-dash (bytes `E2 80 94`) becomes three garbage characters, corrupting later string parsing. The parser reports something like "string is missing the terminator" on a line far from the real offender. Because the install script is the first thing a new user runs, a parse failure here is maximally damaging.

**Markdown code spans.** CommonMark gives backslash escapes no meaning inside an inline code span ([§6.1](https://spec.commonmark.org/0.31.2/#backslash-escapes)), and a span ends at the next backtick run of equal length ([§6.3](https://spec.commonmark.org/0.31.2/#code-spans)). A backslash written to keep a backtick inside a span therefore does the opposite of what it looks like:

```text
`UserError("Run \`archgate init\` first")`
```

That line holds four backticks, not two. The first pairs with the one after `Run \`, closing a span whose content ends in a literal backslash; `archgate init\` falls out into prose; the remaining pair wraps ` first")`. Every delimiter after the first escape re-pairs one position out, so the damage runs to end of line rather than staying local to the snippet. Authors reach for the escape precisely when a snippet contains a backtick, which is when the correct spelling is least familiar.

Neither is visible to the existing pipeline. `format:check` compares a file against its own re-print, and both forms are already in normal form. `oxlint` and `tsc` never open `.ps1` or markdown. The output is well-formed text that decodes wrongly, not malformed text that fails to parse, so nothing downstream has a reason to object.

### Alternatives Analysis

**Add a UTF-8 BOM to the script**: would make 5.1 decode UTF-8 correctly, but a BOM can break `irm | iex` piping and other tooling, and is easy to strip accidentally. Fragile.

**Rely on the formatter to normalise markdown**: rejected. A formatter that preserves these bytes is behaving correctly — the text is well-formed. Pinning the invariant to a formatter's behaviour leaves it unenforced on every version that behaves differently.

**Flag every backslash-backtick byte pair**: rejected. It cannot distinguish a mistaken escape from a code span whose content legitimately ends in a backslash, which a Windows path routinely does. A rule that fires on correct prose is a rule contributors learn to suppress.

**Parse markdown with a full CommonMark implementation**: rejected under [ARCH-006](./ARCH-006-dependency-policy.md) — a parser dependency to detect a single-character defect that a line-oriented scan isolates exactly.

**Restrict the authored bytes and check them lexically** (chosen): ASCII is identical under UTF-8 and Windows-1252, and code-span delimiters can be walked per line. Both are simple, robust, and mechanically checkable with no new dependency.

## Decision

Text this repository authors MUST NOT contain a character sequence that a downstream reader decodes differently from the way it was written. Two such sequences are enforced.

**ASCII-only PowerShell.** All `.ps1` files MUST contain only ASCII characters (byte values 0–127) in comments and string literals. Use `-`/`--` instead of em/en dashes, straight quotes instead of curly quotes, and no other non-ASCII typography or symbols.

To verify a script still parses after editing:

```powershell
$errs = $null
[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path .\install.ps1).Path, [ref]$null, [ref]$errs)
$errs
```

**No escaped backticks in markdown.** Markdown and MDX files MUST NOT contain a backslash-escaped backtick in text content. The correct spelling is a longer delimiter — a run of _n_ backticks ends only at the next run of exactly _n_, so two backticks around a snippet containing single backticks needs no escape — or a restructured sentence giving the inner command a span of its own. When the content itself begins or ends with a backtick, pad with one space on each side; CommonMark strips a single leading and trailing space when both are present.

**Scope.** The markdown invariant is checked on text content only. A backslash before a backtick is legitimate, and is not reported, inside a code span, inside a fenced code block, and inside YAML frontmatter. A backslash that escapes another backslash consumes it, so a literal backslash preceding a span opener is not a violation either. `CHANGELOG.md` is exempt: it is regenerated from commit messages on every release, matching the `ignorePatterns` entry it already carries in `.oxfmtrc.json`.

## Do's and Don'ts

### Do

- **DO** use ASCII punctuation in `.ps1` files: `-`, `--`, straight quotes `'` `"`
- **DO** run the `Parser::ParseFile` check above after editing a distributed `.ps1`
- **DO** wrap a snippet containing backticks in a longer delimiter, as in ``` ``await Bun.$`git ls-files`.text()`` ``` — two backticks outside, single backticks untouched inside
- **DO** pad with one space on each side when a span's content starts or ends with a backtick, so the space is stripped on render
- **DO** put illustrative examples of the broken form inside a fenced code block, which is where the check intentionally does not look — and open that fence with a longer run than any fence nested inside it
- **DO** read a violation's reported column as the character to delete: the backslash for markdown, the offending character for `.ps1`

### Don't

- **DON'T** use em-dashes, en-dashes, curly quotes, ellipsis, or other non-ASCII characters in `.ps1` comments or strings
- **DON'T** write a backslash before a backtick to keep it inside a code span — CommonMark ignores the backslash, so the span closes there
- **DON'T** rely on "it renders fine in my editor" — both corruptions manifest only in a reader you are not using
- **DON'T** re-add spaces by hand when a line's spans look mispaired and assume the source is now correct; the delimiters are still wrong
- **DON'T** suppress the markdown check for a Windows path or any span whose content genuinely ends in a backslash — those are not reported, so a violation there means the delimiters really are unbalanced

## Consequences

### Positive

- **The installer parses on every Windows shell**, including PowerShell 5.1
- **A markdown rendering defect becomes a build failure** — the class of corruption no other stage can see is caught on the same run that would have shipped it
- **Mechanically enforceable with no dependency** — both checks are line scans over files the engine already lists
- **The markdown check is precise by construction**: walking span delimiters rather than grepping for a byte pair distinguishes a mistaken escape from a Windows path ending in a backslash

### Negative

- **No typographic niceties** in PowerShell scripts (acceptable — these are install scripts, not prose)
- **Generated changelog content is unguarded**: a commit message carrying an escaped backtick reaches `CHANGELOG.md` unchecked and renders wrongly on GitHub and npm
- **A single escape immediately before a span's closing delimiter is not reported.** A failed escape and a path that genuinely ends in a backslash are the same bytes — the span's last content character is a backslash in both, and the delimiter after it closes the span:

  ```text
  `show \`literal tick`            the author meant to escape the delimiter
  `C:\Users\<username>\.config\`   a path that really does end in a backslash
  ```

  No lexical rule separates them, so reporting the first reports the second. The check accepts this false negative rather than fire on correct prose. The multi-escape form a mangled snippet almost always takes is still caught, because its later escapes land in text rather than inside a span

- **Code-span state is carried within a block, not beyond it**: a span crossing a line break is tracked to its close, and a blank line clears it because a span cannot outlive its block. A backtick run left unmatched at the end of a paragraph is therefore read as an open span through to the next blank line, costing reports in that remainder rather than reporting against what may be literal content
- **One markdown report per line**: a line with several escaped backticks surfaces the rest on the next run

### Risks

- **A non-ASCII character slips in via copy-paste** (e.g. an em-dash auto-inserted by an editor). **Mitigation:** the companion rule flags any non-ASCII byte in a `.ps1` file with its line and column.
- **An unclosed fence hides the rest of its document.** Fences are paired as CommonMark defines them: a block closes only on its own marker, run at least as long as the opener, with nothing but whitespace after it — so a shorter run, the other marker, or a trailing info string stays content. An opener never closed therefore suppresses the check to end of file. **Mitigation**: the failure direction is suppression, never invention, and an unclosed fence is itself a rendering defect visible on the docs site.
- **MDX expression syntax**: a template literal inside an MDX `{...}` expression is JavaScript, and its backticks are not code-span delimiters. No page here uses one. **Mitigation**: teach the scanner about MDX expressions if such a page appears, rather than weakening the text-content check.

## Compliance and Enforcement

### Automated

- **ARCH-021/ascii-only-ps1**: Scans every `.ps1` file for characters outside the ASCII range (code point > 127) and reports the offending file, line, and character. Severity: error.
- **ARCH-021/no-escaped-backtick-in-markdown**: Reads every `.md` and `.mdx` file in scope, skipping YAML frontmatter and fenced code blocks, and walks each remaining line over its code-span delimiters. Reports the first backslash-escaped backtick found in text content, naming the backslash's column and the longer-delimiter fix. Severity: error.

### Manual

Code reviewers MUST reject `.ps1` changes that introduce non-ASCII characters, and SHOULD run the `Parser::ParseFile` check for non-trivial edits to `install.ps1`. Reviewers MUST read a changed markdown line's spans as CommonMark pairs them, not as the author appears to have intended, whenever a line mixes prose and backticks; a snippet that itself contains a backtick is the signal to check the delimiter length.

**Exceptions**: `CHANGELOG.md` only, on the generated-file grounds stated in Decision. Any further exemption requires amending this ADR's Decision section rather than extending the rule's exclusion set.

## References

- [`install.ps1`](../../install.ps1) — the Windows install script governed by this ADR
- [archgate/cli#515](https://github.com/archgate/cli/issues/515) — the issue that added the markdown invariant
- [CommonMark 0.31.2 §6.1 Backslash escapes](https://spec.commonmark.org/0.31.2/#backslash-escapes) — backslash escapes do not work in code spans
- [CommonMark 0.31.2 §6.3 Code spans](https://spec.commonmark.org/0.31.2/#code-spans) — a span ends at the next backtick string of equal length
- [ARCH-007: Cross-Platform Subprocess Execution](./ARCH-007-cross-platform-subprocess-execution.md) — related cross-platform robustness governance
- [GEN-002: Docs i18n](./GEN-002-docs-i18n.md) — the sibling text-corruption check, scoped to encoding rather than delimiters
- [ARCH-006: Dependency Policy](./ARCH-006-dependency-policy.md) — why these checks scan bytes instead of adding a parser
