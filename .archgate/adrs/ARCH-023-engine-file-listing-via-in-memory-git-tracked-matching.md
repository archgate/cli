---
id: ARCH-023
title: Engine File Listing via In-Memory Git-Tracked Matching
domain: architecture
rules: true
files:
  - "src/engine/**"
---

## Context

Every ADR scope resolution and every rule-facing file listing (`ctx.glob()`, `ctx.grepFiles()`) needs the set of project files matching a glob pattern. Walking the filesystem with `Bun.Glob#scan({ dot: true })` and filtering the results against the git-tracked set _afterwards_ pays the full walk cost before the filter runs: on a target project with 333 tracked files but 43,645 filesystem entries under ignored trees (`.venv/`, `data/`), one `archgate check` performs ~70 such walks — one per ADR scope plus one per rule-level glob. Matching in memory against the tracked set instead cuts engine time 7.2× (1,147ms → 160ms) and ends the CPU saturation.

**Alternatives considered:**

- **Keep scanning, add ignore lists** — Hardcoded `node_modules/`, `.venv/`, `.git/` exclusions cannot anticipate every ignored tree (`data/`, `dist/`, ML artifacts); `.gitignore` is the project's own authoritative list and `git ls-files` already applies it.
- **Cache scan results per run** — Deduplicates identical patterns but still pays one full traversal per unique pattern, and a single walk is already the dominant cost.
- **Rewrite the traversal in a lower-level language** — The traversal is already native (Zig, inside Bun); the waste is algorithmic — visiting 43k entries to keep 333 — and a faster redundant walk is still redundant. Native addons are additionally rejected by [ARCH-006](./ARCH-006-dependency-policy.md) and [ARCH-022](./ARCH-022-ast-aware-rule-context.md)'s alternatives analysis.
- **Match in memory against `git ls-files` output** — The tracked-file set is already fetched once per run (`getGitTrackedFiles`); matching patterns against it with `Bun.Glob#match()` eliminates traversal entirely. Chosen.

`Bun.Glob#match()` is also safer here than scanning: it matches dot-prefixed path segments without any option (scanning requires `dot: true`, see [ARCH-020](./ARCH-020-glob-scan-include-dotfiles.md)), and it handles brace groups whose alternatives contain path separators, which the scanner silently drops ([oven-sh/bun#32596](https://github.com/oven-sh/bun/issues/32596) affects scanning only).

## Decision

The rules engine (`src/engine/`) MUST list files by matching globs **in memory** against the git-tracked set, never by walking the filesystem.

1. **Tracked-file set** — `getGitTrackedFiles` (`src/engine/git-files.ts`) is the file universe: `git ls-files --cached --others --exclude-standard`, **minus** `git ls-files --deleted`. The subtraction is mandatory: `--cached` includes worktree-deleted but unstaged files, which must not reach matching.
2. **Matching** — `matchTrackedFiles` and `listMatchingFiles` (`src/engine/glob-utils.ts`) match in memory via `Bun.Glob#match()`.
3. **Scanning is fallback-only** — `Bun.Glob#scan()` is permitted only where no tracked set exists: the target is not a git repository, or an ADR sets `respectGitignore: false`. Scan call sites are confined to `glob-utils.ts` and `git-files.ts`; a scan elsewhere in the engine is a violation.
4. **Sandbox parity** — In `listMatchingFiles` (behind `ctx.glob`/`ctx.grepFiles`) the [ARCH-022](./ARCH-022-ast-aware-rule-context.md) sandbox contract MUST hold on both the tracked and scan branches: the pattern **and every brace-expanded alternative** pass `safeGlob` (no `..`, no absolute paths) before matching or scanning — a group can hide an absolute alternative (`{/etc/passwd,src/a.ts}`). ADR frontmatter patterns (`resolveScopedFiles`/`matchTrackedFiles`) are exempt — trusted configuration, not rule input.
5. **Per-run caches** — `runChecks` shares `RunCaches` across rule contexts: glob results keyed by pattern + tracked mode, file text keyed by absolute path. Values are promises so concurrent rules share in-flight work; glob arrays are copied on return so one rule's mutation cannot corrupt another's. `readJSON` is deliberately **not** cached — it returns a mutable object that would leak mutations between rules.

**Scope.** Covers file listing inside `src/engine/` only — not commands or helpers outside it, nor the `.rules.ts` load phase (transpile/parse caching is a separate, pending decision).

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

- **Performance:** Engine time on ignored-tree-heavy projects drops more than sevenfold (see the measurement in Context), and CPU saturation during `archgate check` disappears
- **Correctness:** `Bun.Glob#match()` sidesteps the scanner's brace-group bug (oven-sh/bun#32596) and dot-handling pitfalls (ARCH-020) on the primary path
- **Single source of truth:** The file universe is exactly what git considers part of the project
- **Deduplication:** `RunCaches` removes repeated identical globs and reads across every rule in a run

**Negative:**

- **Two code paths:** The scan fallback must stay behaviorally aligned with the fast path (dot handling, brace expansion, sandbox validation)
- **Git dependency for the fast path:** Non-git projects always pay the full walk

**Risks:**

- **Divergence between paths:** A fix applied to one path but not the other yields environment-dependent results. **Mitigation:** shared validation lives in `listMatchingFiles` ahead of the branch; `tests/engine/glob-utils.test.ts` exercises both paths including the sandbox contract.
- **Stale tracked set within a run:** Files created mid-run are invisible to matching. **Mitigation:** acceptable by design — a check run is a snapshot of the project at start.

## Compliance and Enforcement

- **Automated:** The companion rule `scan-confined-to-fallback-modules` (this ADR) parses `src/engine/**/*.ts` via `ctx.ast()` ([ARCH-022](./ARCH-022-ast-aware-rule-context.md)) and walks the ESTree for real `<expr>.scan(...)` call sites, blocking any outside `glob-utils.ts`/`git-files.ts` — structural, not text-based, so a comment or string mentioning `.scan(` cannot be misreported. ARCH-020's `glob-scan-dot` rule covers `dot: true` on the remaining fallbacks. `archgate check` runs both in CI and pre-push.
- **Manual:** Reviewers of `src/engine/` changes verify new file listings route through `glob-utils.ts` and that sandbox validation precedes the tracked/scan branch.
- **Exceptions:** A new scan call site outside the two fallback modules requires updating this ADR (and its rule's allowlist) with justification approved by the maintainer.

## References

- [ARCH-020: Glob Scan Include Dotfiles](./ARCH-020-glob-scan-include-dotfiles.md)
- [ARCH-022: AST-Aware Rule Context](./ARCH-022-ast-aware-rule-context.md)
- [ARCH-006: Dependency Policy](./ARCH-006-dependency-policy.md)
- [ARCH-007: Cross-Platform Subprocess Execution](./ARCH-007-cross-platform-subprocess-execution.md)
- [oven-sh/bun#32596 — Glob scan drops brace groups with path separators](https://github.com/oven-sh/bun/issues/32596)
