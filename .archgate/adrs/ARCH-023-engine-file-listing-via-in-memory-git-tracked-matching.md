---
id: ARCH-023
title: Engine File Listing via In-Memory Git-Tracked Matching
domain: architecture
rules: true
files:
  - "src/engine/**"
---

## Context

Every ADR scope resolution and every rule-facing file listing (`ctx.glob()`, `ctx.grepFiles()`) needs the set of project files matching a glob pattern. Before this decision, each of those call sites walked the filesystem with `Bun.Glob#scan({ dot: true })` and filtered the results against the git-tracked file set _afterwards_. The walk cost was paid in full before the filter ran: on a real target project (333 tracked files, 43,645 filesystem entries under `.venv/`, `data/`, and other ignored trees), a single `archgate check` performed ~70 such walks — one per ADR scope plus one per rule-level glob — driving engine time to 1,147ms and saturating CPU cores with redundant directory traversal. Replacing the walks with in-memory matching cut engine time to 160ms (7.2×) on the same project.

**Alternatives considered:**

- **Keep scanning, add ignore lists** — Hardcoding `node_modules/`, `.venv/`, `.git/` exclusions into the scanner reduces the walk but cannot anticipate every ignored tree (`data/`, `dist/`, ML artifacts). `.gitignore` is the project's own authoritative ignore list, and `git ls-files` already applies it.
- **Cache scan results per run** — Deduplicates identical patterns but still pays one full traversal per unique pattern. On large ignored trees a single walk is already the dominant cost.
- **Rewrite the traversal in a lower-level language** — Rejected: the traversal is already native (Zig, inside Bun). The waste is algorithmic — visiting 43k entries to keep 333 — and a faster redundant walk is still redundant. Native addons are additionally rejected by [ARCH-006](./ARCH-006-dependency-policy.md) and [ARCH-022](./ARCH-022-ast-aware-rule-context.md)'s alternatives analysis.
- **Match in memory against `git ls-files` output** — The tracked-file set is already fetched once per run (see `getGitTrackedFiles`). Matching patterns against that list with `Bun.Glob#match()` eliminates traversal entirely and is the chosen approach.

For Archgate specifically, `Bun.Glob#match()` has two properties that make this safe and simpler than scanning: it matches dot-prefixed path segments without any option (scanning requires `dot: true`, see [ARCH-020](./ARCH-020-glob-scan-include-dotfiles.md)), and it handles brace groups whose alternatives contain path separators correctly (the scanner silently returns empty results for them — [oven-sh/bun#32596](https://github.com/oven-sh/bun/issues/32596) affects scanning only).

## Decision

The rules engine (`src/engine/`) MUST list project files by matching glob patterns **in memory** against the git-tracked file set, not by walking the filesystem.

1. **Tracked-file set** — `getGitTrackedFiles` in `src/engine/git-files.ts` is the single source of the file universe: `git ls-files --cached --others --exclude-standard`, **minus** `git ls-files --deleted`. The subtraction is mandatory — `--cached` lists files deleted from the worktree but not yet staged, which a filesystem walk would never return; in-memory matching must see exactly the files that exist on disk.
2. **Matching** — `matchTrackedFiles` and `listMatchingFiles` in `src/engine/glob-utils.ts` perform the in-memory match via `Bun.Glob#match()`.
3. **Scanning is fallback-only** — `Bun.Glob#scan()` is permitted solely for the cases where no tracked set exists: the target is not a git repository, or an ADR sets `respectGitignore: false`. Scan call sites in `src/engine/` are confined to `src/engine/glob-utils.ts` and `src/engine/git-files.ts`. Adding a scan call anywhere else in the engine is a violation.
4. **Sandbox parity** — Within `listMatchingFiles` (the rule-facing entry point behind `ctx.glob`/`ctx.grepFiles`), the rule sandbox contract ([ARCH-022](./ARCH-022-ast-aware-rule-context.md)) MUST hold on both of its internal branches (in-memory tracked match and scan fallback): the pattern **and every brace-expanded alternative** pass `safeGlob` validation (no `..`, no absolute paths) before matching or scanning. Brace expansion can surface absolute alternatives hidden inside a group (e.g. `{/etc/passwd,src/a.ts}`). `resolveScopedFiles`/`matchTrackedFiles` with ADR frontmatter patterns are exempt — frontmatter is trusted project configuration, not rule input (see Do's below).
5. **Per-run caches** — `runChecks` shares `RunCaches` (glob results keyed by pattern + tracked mode, file text keyed by absolute path) across all rule contexts. Cached values are promises so concurrent rules share in-flight work. Glob arrays are copied on return so a rule mutating its result cannot corrupt another rule's view. `readJSON` is deliberately **not** cached — it returns a mutable object, and sharing one instance would leak mutations between rules.

**Scope.** This ADR covers file listing inside `src/engine/`. It does not constrain commands or helpers outside the engine, and it does not cover the `.rules.ts` load phase (transpile/parse caching is a separate, pending decision).

## Do's and Don'ts

### Do

- **DO** route every new engine file listing through `listMatchingFiles` (rule-facing, sandboxed) or `matchTrackedFiles` (trusted ADR frontmatter patterns) in `src/engine/glob-utils.ts`
- **DO** pass the tracked set from `getGitTrackedFiles` whenever the target is a git repository and `respectGitignore` is not `false`
- **DO** keep the `--deleted` subtraction in `getGitTrackedFiles` when refactoring — without it, tracked-but-deleted files reach rules and crash `ctx.readFile` with `ENOENT`
- **DO** validate the pattern and every brace-expanded alternative with `safeGlob` before matching or scanning
- **DO** copy cached glob arrays before returning them to rule code
- **DO** pass `{ dot: true }` on the remaining scan fallbacks, per [ARCH-020](./ARCH-020-glob-scan-include-dotfiles.md)

### Don't

- **DON'T** call `Bun.Glob#scan()` anywhere in `src/engine/` outside `glob-utils.ts` and `git-files.ts` — the companion rule blocks this
- **DON'T** filter scan results against the tracked set as a substitute for in-memory matching — the traversal cost is paid before the filter runs
- **DON'T** cache `readJSON` results — rules receive mutable objects
- **DON'T** skip `safeGlob` on the in-memory path because "matching a tracked list cannot escape the root" — the explicit rejection contract must be identical on both paths, and tests pin it
- **DON'T** hardcode ignore lists (`node_modules/`, `.venv/`) into the scanner — `.gitignore` via `git ls-files` is the authoritative source

## Consequences

**Positive:**

- **Performance:** Engine time on ignored-tree-heavy projects drops by an order of magnitude (measured 7.2× on a 43k-entry project); CPU saturation during `archgate check` disappears
- **Correctness:** `Bun.Glob#match()` sidesteps the scanner's brace-group bug (oven-sh/bun#32596) and dot-handling pitfalls (ARCH-020) on the primary path
- **Single source of truth:** The file universe is exactly what git considers part of the project
- **Deduplication:** `RunCaches` removes repeated identical globs and reads across 40+ rules

**Negative:**

- **Two code paths:** The scan fallback must be kept behaviorally aligned with the fast path (dot handling, brace expansion, sandbox validation)
- **Git dependency for the fast path:** Non-git projects always pay the full walk

**Risks:**

- **Divergence between paths:** A fix applied to one path but not the other yields environment-dependent results. **Mitigation:** shared validation lives in `listMatchingFiles` ahead of the branch; `tests/engine/glob-utils.test.ts` exercises both paths including the sandbox contract.
- **Stale tracked set within a run:** Files created mid-run are invisible to matching. **Mitigation:** acceptable by design — a check run is a snapshot; the same was true of the pre-existing per-run `trackedFilesCache`.

## Compliance and Enforcement

- **Automated:** The companion rule `scan-confined-to-fallback-modules` (this ADR) blocks `Bun.Glob#scan()` call sites in `src/engine/` outside `glob-utils.ts`/`git-files.ts`. ARCH-020's `glob-scan-dot` rule covers `dot: true` on the remaining fallbacks. `archgate check` runs both in CI and pre-push.
- **Manual:** Reviewers of `src/engine/` changes verify new file listings route through `glob-utils.ts` and that sandbox validation precedes the tracked/scan branch.
- **Exceptions:** A new scan call site outside the two fallback modules requires updating this ADR (and its rule's allowlist) with justification approved by the maintainer.

## References

- [ARCH-020: Glob Scan Include Dotfiles](./ARCH-020-glob-scan-include-dotfiles.md)
- [ARCH-022: AST-Aware Rule Context](./ARCH-022-ast-aware-rule-context.md)
- [ARCH-006: Dependency Policy](./ARCH-006-dependency-policy.md)
- [ARCH-007: Cross-Platform Subprocess Execution](./ARCH-007-cross-platform-subprocess-execution.md)
- [oven-sh/bun#32596 — Glob scan drops brace groups with path separators](https://github.com/oven-sh/bun/issues/32596)
