---
id: ARCH-021
title: ASCII-Only PowerShell Scripts
domain: architecture
rules: true
files: ["**/*.ps1"]
---

# ASCII-Only PowerShell Scripts

## Context

Archgate distributes a Windows installer, `install.ps1`, fetched and executed with `irm ... | iex`. The file is saved without a UTF-8 byte-order mark (its first bytes are `# A...`). On **Windows PowerShell 5.1** — still the default shell on a large share of Windows machines — a BOM-less `.ps1` is decoded using the system codepage (typically Windows-1252), not UTF-8.

The consequence: any multi-byte UTF-8 character in the file is mis-decoded. An em-dash (`—`, bytes `E2 80 94`) becomes three garbage characters, which corrupts later string parsing. The failure mode is cryptic — the parser reports errors like "string is missing the terminator" on lines that look perfectly fine, far from the actual offending character. Because the install script is the very first thing a new user runs, a parse failure here is maximally damaging.

This is not hypothetical: a non-ASCII character in `install.ps1` is exactly the kind of edit that passes review (it looks fine in a UTF-8 editor) and breaks only on PowerShell 5.1.

### Alternatives Analysis

**Add a UTF-8 BOM to the script**: Would make 5.1 decode UTF-8 correctly, but a BOM can break `irm | iex` piping and other tooling, and is easy to strip accidentally. Fragile.

**Restrict distributed `.ps1` files to ASCII**: Eliminates the decoding ambiguity entirely — ASCII is identical under UTF-8 and Windows-1252. Simple, robust, mechanically checkable. Chosen.

## Decision

All `.ps1` files in the repository MUST contain only ASCII characters (byte values 0–127) in comments and string literals. Use `-`/`--` instead of em/en dashes, straight quotes instead of curly quotes, and avoid any other non-ASCII typography or symbols.

To verify a script still parses after editing:

```powershell
$errs = $null
[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path .\install.ps1).Path, [ref]$null, [ref]$errs)
$errs
```

## Do's and Don'ts

### Do

- **DO** use ASCII punctuation in `.ps1` files: `-`, `--`, straight quotes `'` `"`
- **DO** run the `Parser::ParseFile` check above after editing a distributed `.ps1`

### Don't

- **DON'T** use em-dashes (`—`), en-dashes (`–`), curly quotes (`“ ” ‘ ’`), ellipsis (`…`), or other non-ASCII characters in `.ps1` comments or strings
- **DON'T** rely on "it renders fine in my editor" — the corruption only manifests under Windows PowerShell 5.1 with a BOM-less file

## Consequences

### Positive

- **The installer parses on every Windows shell**, including PowerShell 5.1
- **Mechanically enforceable** — non-ASCII bytes are trivially detectable

### Negative

- **No typographic niceties** in PowerShell scripts (acceptable — these are install scripts, not prose)

### Risks

- **A non-ASCII character slips in via copy-paste** (e.g., an em-dash auto-inserted by an editor). **Mitigation:** the companion rule flags any non-ASCII byte in a `.ps1` file with its line and column.

## Compliance and Enforcement

### Automated

- **Archgate rule** ARCH-021/ascii-only-ps1: Scans every `.ps1` file for characters outside the ASCII range (code point > 127) and reports the offending file, line, and character. Severity: error.

### Manual

Code reviewers MUST reject `.ps1` changes that introduce non-ASCII characters, and SHOULD run the `Parser::ParseFile` check for non-trivial edits to `install.ps1`.

## References

- [`install.ps1`](../../install.ps1) — the Windows install script governed by this ADR
- [ARCH-007: Cross-Platform Subprocess Execution](./ARCH-007-cross-platform-subprocess-execution.md) — related cross-platform robustness governance
