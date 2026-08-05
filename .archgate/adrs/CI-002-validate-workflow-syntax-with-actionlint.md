---
id: CI-002
title: Validate Workflow Syntax with Actionlint
domain: ci
rules: false
---

## Context

### Problem Statement

`.github/workflows/*.yml` files are hand-written YAML whose schema GitHub enforces only at execution time: an invalid `permissions:` scope, a malformed expression, or a shellcheck-flagged `run:` block is invisible until the job runs — or silently does nothing and never runs as intended. This repository's only workflow-file static analysis is `zizmor` (the `zizmor` job in `.github/workflows/code-pull-request.yml`, config at `zizmor.yml`), a **security** scanner: template injection, credential persistence, unpinned actions. It has no model of GitHub's permission-scope schema, expression syntax, or `run:`-block shell correctness — a different class of defect entirely.

### Pain Points

- A syntactically well-formed but semantically invalid key (e.g. a `permissions:` scope name that does not exist) passes every check this repository runs, because nothing in the pipeline validates workflow YAML against GitHub's schema
- Such an error can sit unnoticed indefinitely when its job runs rarely — release-only jobs sometimes execute once per release
- Reviewers without workflow-schema expertise cannot reliably catch this class of error by reading the YAML: the key looks plausible and is only obviously wrong against GitHub's documented scope list
- This is not hypothetical: an invalid `workflows: write` entry in `publish-shims.yml`'s `permissions:` block merged via [PR #451](https://github.com/archgate/cli/pull/451) and did nothing silently; it surfaced only because a third-party reviewer happened to run `actionlint` internally and flagged `unknown permission scope "workflows"`

### Alternatives Analysis

- **Rely on zizmor alone**: valuable but explicitly out of scope for schema correctness — schema validation is not its design goal and its maintainers do not position it as a schema linter
- **Rely on third-party review tooling (CodeRabbit, Cursor Bugbot)**: not a dependable control — this project cannot pin, control, or guarantee another tool's internal implementation
- **`reviewdog/action-actionlint`**: adds a Docker container action and a new `uses:` trust surface (subject to [CI-001](./CI-001-pin-github-actions-by-hash.md)'s SHA-pinning requirement) plus image execution overhead, for what is one static-check binary invocation; the direct-binary approach needs no `uses:` reference at all
- **Manual periodic audits of workflow files**: no enforcement mechanism and does not scale — exactly the failure mode that let the defect above merge

### Project-Specific Motivation

The release pipeline (`publish-shims.yml`, `release-binaries.yml`) is exercised far less often than the pull-request pipeline — some jobs run once per release, weeks apart. A schema defect there stays dormant through many merges and then fails during an actual release. Catching this defect class on every PR, before merge, is strictly better.

## Decision

`.github/workflows/code-pull-request.yml` MUST run `actionlint` as a dedicated job required by the `status` gate (the single required status check for branch protection) — a hard blocker, not advisory-only.

**Installation** MUST be: download the prebuilt `rhysd/actionlint` release tarball at an explicit pinned version (not `latest`), verify it against the SHA-256 checksum from that release's `actionlint_<version>_checksums.txt` asset (sourced at authoring time), then extract:

```yaml
- name: Install actionlint
  env:
    VERSION: <version>
    SHA256: <sha256 of the linux_amd64 tarball>
  run: |
    curl -fsSL -o actionlint.tar.gz "https://github.com/rhysd/actionlint/releases/download/v${VERSION}/actionlint_${VERSION}_linux_amd64.tar.gz"
    echo "${SHA256}  actionlint.tar.gz" | sha256sum -c -
    tar -xzf actionlint.tar.gz actionlint
- name: Run actionlint
  run: ./actionlint -color
```

It is a raw download, not a `uses:` reference, so [CI-001](./CI-001-pin-github-actions-by-hash.md)'s `no-unpinned-actions` rule does not scan it; the same reproducibility principle applies voluntarily. Release assets are **mutable**, so checksum verification is what makes the download reproducible — installer scripts are not equivalent (see Don'ts).

**Scope**: only whether and how `actionlint` runs as a hard-blocking CI job. Not `zizmor` (governed by inline comments in `code-pull-request.yml`, not a formal ADR); does not revise CI-001's `uses:`-pinning requirements.

**Relationship to [GEN-003](./GEN-003-tool-invocation-via-scripts.md)**: GEN-003 routes linting/formatting/validation through `package.json` scripts, but targets this project's own JS/TS toolchain — its rule matches `prettier`, `oxfmt`, `oxlint`, `eslint`, `biome`. `actionlint` is an external Go binary with no npm involvement, invoked directly in CI like the `zizmor` job's tool: GEN-003 does NOT apply to CI-only, non-npm static analysis, and no `package.json` wrapper is required or expected.

## Do's and Don'ts

### Do

- **DO** run `actionlint` as its own job in `.github/workflows/code-pull-request.yml`, listed in the `status` gate's `needs:` array and result check
- **DO** pin the actionlint version explicitly — never `latest`
- **DO** pin the tarball's SHA-256 checksum from that release's `actionlint_<version>_checksums.txt` asset, and verify with `sha256sum -c` before extracting
- **DO** set `persist-credentials: false` on the job's `actions/checkout` step, as in the `zizmor` job
- **DO** treat `actionlint` findings as hard blockers — unlike `zizmor`'s advisory carve-outs for fork PRs and its findings backlog, `actionlint` starts from a clean slate and should stay that way
- **DO** re-resolve version and SHA-256 checksum together when upgrading, as CI-001 requires for `uses:` references — fetch the checksum from `https://github.com/rhysd/actionlint/releases/download/v<version>/actionlint_<version>_checksums.txt`

### Don't

- **DON'T** add a `reviewdog/action-actionlint`-style wrapper Action — Docker execution overhead and a new `uses:` trust surface for no capability beyond pass/fail
- **DON'T** treat `actionlint` findings as advisory-only — an advisory signal from a third-party reviewer's internal tooling is not a dependable control
- **DON'T** add a `package.json` script to wrap `actionlint` under the belief that GEN-003 requires it — GEN-003 governs this project's own JS/TS toolchain, not external CI-only binaries
- **DON'T** install via a download-then-run script (e.g. `bash <(curl ... download-actionlint.bash)`) — even with the script's commit pinned it fetches the binary unverified, so the pin covers the downloader not the binary that runs; OSSF Scorecard's Pinned-Dependencies check flags the pattern
- **DON'T** download the tarball without verifying its SHA-256 checksum, and never resolve the version to `latest` — release assets are mutable, so an unverified download reintroduces the non-reproducibility CI-001 prevents

## Consequences

### Positive

- **Catches the motivating defect class**: `actionlint` flags invalid `permissions:` scopes, malformed expressions, and shellcheck issues in `run:` blocks before merge, independent of any third-party review tool
- **Complements, not duplicates, zizmor**: security-pattern scanning and schema validation cover disjoint failure classes, so running both closes a real gap
- **No new third-party Action trust surface**: direct-binary installation adds no `uses:` reference, leaving CI-001's pinning surface unchanged
- **Reproducible tooling**: pinned version plus pinned SHA-256 means the same binary runs on every CI invocation until deliberately upgraded — a re-uploaded release asset fails the checksum comparison
- **Catches defects in rarely-executed release-pipeline jobs before they ever run for real**

### Negative

- **Another CI job**: adds a small fixed cost per PR run (binary download plus lint pass), minor relative to total pipeline duration
- **Manual version bumps**: Renovate/Dependabot do not propose updates for a pinned version-plus-checksum download pattern; upgrading requires a manual PR updating both values together
- **Linux-only checksum**: the pinned checksum covers the `linux_amd64` tarball only — moving the job off `ubuntu-latest` requires changing both the URL and the checksum

### Risks

- **Stale actionlint version**: with no automated dependency tooling watching this pattern, the pin can fall behind new releases and their bug fixes or new schema checks.
  - **Mitigation:** Treat `actionlint` version bumps the way CI-001 treats `uses:` SHA bumps — periodic manual review during any broader CI/workflow maintenance pass.
- **Scope regression**: `actionlint` runs against all `.github/workflows/*.yml` by default (via `./actionlint` with no path argument), but a future refactor of the job could accidentally scope it to a subset of files.
  - **Mitigation:** Code review of any change to the `actionlint` job step MUST verify the invocation still covers the entire `.github/workflows/` directory with no path restriction.

## Compliance and Enforcement

### Automated Enforcement

- The `actionlint` job in `.github/workflows/code-pull-request.yml`, required by the `status` gate job, fails the pipeline on any `actionlint` finding.

### Manual Enforcement

Code reviewers MUST verify, for any change to the `actionlint` job:

1. The download remains pinned to an explicit actionlint version, not `latest`, and the SHA-256 checksum is verified with `sha256sum -c` before the binary is extracted
2. On any version bump, the new checksum was sourced from the release's own `actionlint_<version>_checksums.txt` asset — not computed from a locally downloaded file without cross-referencing
3. `actionlint` remains listed in the `status` gate job's `needs:` array and result check — removing it silently downgrades this from a hard blocker to a no-op
4. The job's invocation still scans the entire `.github/workflows/` directory, not a restricted subset

### Exceptions

None. If `actionlint` produces a false positive for a legitimate, GitHub-supported syntax it does not yet recognize, resolve by upgrading to a newer `actionlint` version first; if the false positive persists on the current version, escalate to the project maintainer and document the specific suppression (if any) in this ADR rather than silently disabling the job.

## References

- [CI-001: Pin GitHub Actions by Commit SHA](./CI-001-pin-github-actions-by-hash.md) — governs `uses:` reference pinning; this ADR applies the same reproducibility principle to a non-`uses:` script fetch
- [GEN-003: Tool Invocation via Package Scripts](./GEN-003-tool-invocation-via-scripts.md) — governs this project's own JS/TS toolchain invocation; does not apply to external CI-only tooling like `actionlint`
- [ARCH-006: Dependency Policy](./ARCH-006-dependency-policy.md) — general project minimalism philosophy informing the rejection of a wrapper Action in favor of direct binary installation
- `.github/workflows/` — the pinned actionlint invocation and its checksum verification
- [rhysd/actionlint](https://github.com/rhysd/actionlint) — the tool itself
- [GitHub Actions workflow syntax — `permissions`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) — the authoritative schema `actionlint` validates against
