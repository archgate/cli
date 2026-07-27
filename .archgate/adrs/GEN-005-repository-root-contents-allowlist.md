---
id: GEN-005
title: Repository Root Contents Allowlist
domain: general
rules: true
---

# Repository Root Contents Allowlist

## Context

`bun run validate` is a fail-fast pipeline of lint, typecheck, format:check, test, ADR check, knip, and build check — but every one of those stages is scoped to a directory or a file glob, and none of them is scoped to "the repository root as a whole." A file dropped directly at the project root falls outside all of them simultaneously:

- **Not linted**: `oxlint` (via `.oxlintrc.json`) targets `src/`, `tests/`, `lint/`, `scripts/`, `shims/` — a loose root-level file is never in its input set.
- **Not typechecked**: `tsconfig.json`'s `include` lists `src/`, `tests/`, `lint/` — a `.ts` file at the root is outside the composite project and `tsc --build` never opens it.
- **Not seen by knip**: dead-export detection walks from the declared entry points and project globs, not the filesystem root.
- **Not matched by any ADR**: every `files`-scoped ADR (`GEN-004`, `ARCH-005`, ...) names subdirectories; nothing declares an interest in root-level filenames as a category.

Issue [archgate/cli#500](https://github.com/archgate/cli/issues/500) is the concrete failure this produces: a throwaway helper script (`fix-sec-test.py`) was created at the repository root to drive a one-off fix, its cleanup was chained with `&&` (`python fix-sec-test.py && rm -f fix-sec-test.py`), and when the script exited non-zero the cleanup never ran. A later `git add -A` picked up the orphaned file and it reached a commit — invisible to every gate above, because none of them looks at "did a new file appear at the root."

The root is not an arbitrary directory: it is also this project's public surface. `.npmignore`, the compiled-binary distribution model ([ARCH-017](./ARCH-017-multi-ecosystem-distribution.md)), and the repository's own README all treat the root as a small, deliberate set of manifests, license/governance documents, and tool-config dotfiles — not a place where working files accumulate. A stray file at the root is functionally different from a stray file in `src/`: it is likely to be committed (nothing local rejects it), likely to be irrelevant to the reader within days, and disproportionately visible (it is the first thing anyone browsing the repository, or packaging it for a registry, sees).

### Alternatives considered

1. **Extend existing tool scopes to include the root** — `oxlint`, `tsc`, and knip each check _file contents_: syntax, types, dead exports. A stray root file that happens to be syntactically valid TypeScript or a well-formed shell script would pass all three; the defect here is the file's _presence and location_, not its content. Forcing content-scoped tools to also police placement conflates two different concerns and still leaves non-TS/JS scratch files (`.py`, `.sh`, arbitrary text) unchecked.
2. **Denylist scratch-looking extensions at the root** (`.py`, `.sh`, ad hoc `.ts`/`.js`) — Rejected: the repository already ships a legitimate root-level `.js` file, `.simple-release.js` (configuration for `@simple-release/npm`), so an extension-based denylist either produces a false positive on day one or requires the same kind of extension-specific carve-out list that an allowlist gives for free, with the added risk that a genuinely thrown-away `.json` or `.md` file at the root sails through untouched.
3. **A pre-commit hook that greps `git status` for untracked root files** — Duplicates the ADR/rules mechanism this project already uses for every other governance decision, is invisible to `archgate check`/`archgate review-context` (so it does not surface to agents reviewing a diff before commit), and is bypassable with `--no-verify` the same way any other hook is.
4. **An explicit allowlist of exact root-level filenames, enforced as a companion `.rules.ts`** (chosen) — Mirrors [GEN-003](./GEN-003-tool-invocation-via-scripts.md)'s idiom of a rule asserting a property of repository layout rather than of a single source file's contents. An allowlist is the only representation that correctly admits `.simple-release.js` while still rejecting `fix-sec-test.py`: it says what belongs, not what looks suspicious.

For a project whose product _is_ machine-checkable governance, leaving its own root ungoverned is the exact gap an external audit would flag — and did (this ADR originates from an agent-memory entry from such an audit, which correctly concluded the finding was a rule to write, not a lesson to keep re-remembering).

## Decision

The repository root MUST contain only files that appear on an explicit allowlist maintained in the companion rules file. Any file that is git-tracked or untracked-but-not-gitignored at the repository root, and is not on that allowlist, is a violation.

**Scope**: This ADR governs the flat set of _files_ directly inside the repository root, not subdirectories (`src/`, `docs/`, `.github/`), which remain governed by their own tooling and ADRs. Root-level _directories_ are also out of scope: `git ls-files` enumerates files, never directories, so a new root-level directory cannot be flagged here and must be caught by review instead.

**Allowlist semantics**: exact filenames, not extensions or patterns. A file qualifies if it meets at least one criterion:

- It is a package manifest or lockfile Bun/npm tooling requires at the root (`package.json`, `bun.lock`, `bunfig.toml`).
- It is a tool configuration file that its tool requires at the root by convention (`tsconfig.json`, `knip.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `.commitlintrc.json`, `.prototools`, `.simple-release.js`, `renovate.json`, `zizmor.yml`).
- It is a governance or community-health document GitHub or npm surfaces specially when placed at the root (`README.md`, `LICENSE.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, `MAINTAINERS.md`, `ROADMAP.md`, `APPROVAL_POLICY.md`, `ASSURANCE-CASE.md`, `CLAUDE.md`).
- It is a git/npm mechanism dotfile that only functions when placed at the root (`.gitignore`, `.gitattributes`, `.npmignore`, `.githooks`).
- It is a platform install entry point referenced by the published install instructions (`install.sh`, `install.ps1`).

Any file added at the root in the future MUST be added to the allowlist in the same change, with the criterion above it satisfies stated in the PR description or commit message.

## Do's and Don'ts

### Do

- **DO** add new root-level files to the allowlist in `GEN-005-repository-root-contents-allowlist.rules.ts` in the same commit that introduces the file.
- **DO** put one-off scripts, scratch files, and exploratory helpers inside `scripts/` (tracked, reviewed) or an untracked, gitignored scratch directory — never at the repository root.
- **DO** use `;` or a `trap` for temp-file cleanup that must run regardless of exit status: `python fix.py; rm -f fix.py` or `trap 'rm -f fix.py' EXIT`.
- **DO** run `git status` (or `git add <explicit paths>`) before committing when a scratch file may exist nearby, so an orphaned file is visible before it is staged.
- **DO** treat a `GEN-005/no-unlisted-root-files` violation as a signal to either delete the flagged file or extend the allowlist with justification — never to suppress without one.
- **DO** keep the allowlist as exact filenames, matching the reasoning in Decision — a new config file's exact name, not a wildcard extension.

### Don't

- **DON'T** chain a scratch script and its own cleanup with `&&` (`python fix.py && rm -f fix.py`) — a non-zero exit skips the cleanup, which is exactly how [archgate/cli#500](https://github.com/archgate/cli/issues/500) happened.
- **DON'T** run `git add -A` or `git add .` as a matter of habit when a throwaway file might exist in the working tree — stage explicit paths instead.
- **DON'T** add a file to the root allowlist "to unblock the check" without stating which criterion in Decision it satisfies.
- **DON'T** assume a file is safe from this check because it is gitignored before it's created — the check runs against the same tracked-plus-untracked-not-ignored set `archgate check` always uses, so a scratch file is flagged as soon as it exists and is not gitignored, before it is ever staged or committed.
- **DON'T** rely on file extension to decide whether a root file looks legitimate — `.simple-release.js` is a real, required config file despite its extension resembling a script.

## Consequences

### Positive

- **Closes the exact gap in #500**: a stray root-level file — script or otherwise — is now caught by `archgate check` before it can be committed, independent of its file extension or syntactic validity.
- **No false positive on existing root files**: the allowlist is derived from and matches the repository's actual current root contents, including the extension-ambiguous `.simple-release.js`.
- **Cheap and durable check**: comparing a small, cached list of root-level filenames against a static allowlist is O(root file count), not a filesystem walk, and needs no AST parsing.
- **Self-documenting root**: the allowlist doubles as an explicit, reviewable manifest of "everything this project ships at its root and why," addressing the drift that made the gap invisible in the first place.
- **Consistent with GEN-003's precedent**: extends the pattern of a companion rule asserting a property of repository layout, keeping enforcement idioms uniform across ADRs.

### Negative

- **Maintenance tax on legitimate root additions**: every new root-level tool config or governance document requires a same-commit edit to the rules file's allowlist, adding one extra step to an otherwise simple addition.
- **Root-level directories are unguarded**: because git only tracks files, a stray _directory_ placed at the root is invisible to this check; only files are covered.
- **A permissive allowlist entry is a standing exception**: once a filename is added, the rule cannot distinguish a legitimate use of that exact name from a future misuse of it (e.g., a second, unrelated file that happens to share an allowlisted name would also pass) — this is an accepted trade-off of exact-name matching over content inspection.

### Risks

- **Allowlist drift**: a legitimate new root file is rejected because the allowlist wasn't updated in the same change, blocking an unrelated PR. **Mitigation**: the violation message names the exact missing filename and points to this ADR's Decision criteria, so the fix is a one-line addition to the rules file rather than a debugging session.
- **Allowlist creep**: over time, contributors add filenames to "make the check pass" without applying the Decision criteria, defeating the purpose of an explicit allowlist. **Mitigation**: manual review (below) requires the PR to state which criterion is satisfied; `archgate:reviewer` and human reviewers both check this at review time.

## Compliance and Enforcement

**Automated enforcement** (companion `GEN-005-repository-root-contents-allowlist.rules.ts`):

- **GEN-005/no-unlisted-root-files**: Lists root-level files via `ctx.glob("*")` (matches in-memory against the tracked-plus-untracked-not-gitignored file set per [ARCH-023](./ARCH-023-engine-file-listing-via-in-memory-git-tracked-matching.md), so gitignored build artifacts never reach the check and a newly created, not-yet-committed scratch file is still caught) and reports a violation for any entry not present in the rule's `ALLOWED_ROOT_FILES` list. Severity: error.

**Manual enforcement**: Code reviewers MUST verify that any PR adding a new file at the repository root also updates `ALLOWED_ROOT_FILES` in the companion rules file, and that the PR description or commit message states which Decision criterion the new file satisfies. Reviewers MUST reject a bare allowlist addition with no stated justification.

**Exceptions**: None by default. A root-level file that does not fit any Decision criterion but is nonetheless required (e.g., a new ecosystem's install entry point) requires updating this ADR's Decision section with the new criterion, not just adding the filename to the rule.

## References

- [archgate/cli#500](https://github.com/archgate/cli/issues/500) — the incident this ADR closes the gap on
- [archgate/cli#514](https://github.com/archgate/cli/issues/514) — this ADR's originating issue
- [GEN-003: Tool Invocation via Package Scripts](./GEN-003-tool-invocation-via-scripts.md) — the closest existing idiom: a companion rule asserting a property of repository layout
- [GEN-004: Concise, Forward-Only Code Comments](./GEN-004-concise-forward-only-code-comments.md) — another GEN-domain decision enforced by an explicit, maintained list (its structural-tag exemptions) rather than a heuristic alone
- [ARCH-023: Engine File Listing via In-Memory Git-Tracked Matching](./ARCH-023-engine-file-listing-via-in-memory-git-tracked-matching.md) — why `ctx.glob()` sees untracked-but-not-ignored files, which is what lets this rule catch a scratch file before it is committed
- [ARCH-017: Multi-Ecosystem Distribution](./ARCH-017-multi-ecosystem-distribution.md) — the root is part of this project's shipped, public surface
