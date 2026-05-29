---
id: ARCH-020
title: Glob Scanning Must Include Dotfiles
domain: architecture
rules: true
files: ["src/**/*.ts"]
---

# Glob Scanning Must Include Dotfiles

## Context

`Bun.Glob.scan()` defaults to `dot: false`, which skips any match whose path contains a dot-prefixed segment — **even when the pattern explicitly names that directory**. A pattern like `.github/workflows/release.yml` returns nothing under the default. Worse, the behavior is platform-dependent: Windows reliably drops the match while Linux can match the same pattern, so a glob appears to "work in CI" but silently no-ops on a contributor's Windows machine.

Archgate is a code-governance tool. The directories it must inspect — `.github/`, `.husky/`, `.vscode/`, `.archgate/` — are dot-prefixed by convention. Treating them as first-class source means every `scan()` over the project tree must opt into dotfiles, or rules that target CI workflows and tooling config will silently scan nothing. This caused [archgate/cli#222](https://github.com/archgate/cli/issues/222): rules over `.github/workflows/**` no-opped locally while passing in CI.

### Alternatives Analysis

**Rely on the `dot: false` default and avoid dot-dirs**: Impossible — the files we must govern live in dot-dirs.

**Pass `dot: true` at every `scan()` call site**: Explicit, local, and mechanically checkable. The engine already does this in `src/engine/runner.ts` (`ctx.glob`, `ctx.grepFiles`) and `src/engine/git-files.ts` (`resolveScopedFiles`). Chosen.

## Decision

Every call to `Bun.Glob#scan()` (`glob.scan(...)`) in source MUST pass `{ dot: true }` in its options object, so dot-prefixed segments are traversed. This applies regardless of whether the current glob pattern targets a dot-dir — the requirement is unconditional to prevent a future pattern from silently no-opping.

## Do's and Don'ts

### Do

- **DO** call `glob.scan({ cwd, dot: true })` — always include `dot: true`
- **DO** normalize separators after scanning (`file.replaceAll("\\", "/")`) for cross-platform path comparisons

### Don't

- **DON'T** call `glob.scan(...)` without `dot: true` — even for patterns that don't obviously touch a dot-dir
- **DON'T** assume a glob that works on Linux works on Windows; the `dot` default diverges across platforms

## Consequences

### Positive

- **Rules see dot-dirs** (`.github/`, `.husky/`, `.vscode/`, `.archgate/`) consistently
- **Cross-platform parity** — no more "works in CI, no-ops locally" glob bugs

### Negative

- **Includes more paths** — callers that genuinely want to exclude dotfiles must filter explicitly (rare in this codebase)

### Risks

- **A new `scan()` added without `dot: true`** silently skips dot-dirs on Windows. **Mitigation:** the companion rule flags any `.scan(` call whose options lack `dot:`.

## Compliance and Enforcement

### Automated

- **Archgate rule** ARCH-020/glob-scan-dot: Scans `src/**/*.ts` for `.scan(` calls and reports any whose argument list does not contain `dot:`. Severity: error.

### Manual

Code reviewers MUST verify new `Bun.Glob` scans pass `dot: true` and that any intentional exclusion of dotfiles is done by explicit post-scan filtering with a comment.

## References

- [archgate/cli#222](https://github.com/archgate/cli/issues/222) — the dotfile-skipping bug this ADR prevents
- [`src/engine/runner.ts`](../../src/engine/runner.ts), [`src/engine/git-files.ts`](../../src/engine/git-files.ts) — canonical `scan({ dot: true })` usage
- [ARCH-009: Platform Detection Helper](./ARCH-009-platform-detection-helper.md) — related cross-platform correctness governance
