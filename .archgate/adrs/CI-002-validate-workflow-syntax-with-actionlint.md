---
id: CI-002
title: Validate Workflow Syntax with Actionlint
domain: ci
rules: false
---

## Context

### Problem Statement

`.github/workflows/*.yml` files are hand-written YAML with a schema GitHub enforces only at execution time — a malformed `permissions:` key, an invalid expression, or a shellcheck-flagged `run:` block is invisible until the workflow actually runs (or, worse, silently does nothing and never runs at all in the way the author intended). This repository's only workflow-file static analysis is `zizmor` (`.github/workflows/code-pull-request.yml`'s `zizmor` job, config at `zizmor.yml`), which is a **security**-focused scanner: template-injection, credential persistence, unpinned actions. It has no concept of GitHub's actual permission-scope schema, expression syntax, or `run:`-block shell correctness — those are a different class of defect entirely.

### Pain Points

- A workflow file can contain a syntactically well-formed but semantically invalid key (e.g., a `permissions:` scope name that does not exist) and pass every check this repository runs, because no check in the pipeline validates workflow YAML against GitHub's schema
- Such an error can sit unnoticed indefinitely if the specific job never runs during ordinary development (release-only jobs, in particular, execute rarely — sometimes only once per release)
- Code review by a human or an AI reviewer without workflow-schema expertise cannot reliably catch this class of error by reading the YAML — the key looks plausible, resembles a real permission name, and the mistake is only obvious against GitHub's actual documented scope list
- **Concrete incident**: [PR #451](https://github.com/archgate/cli/pull/451) added `workflows: write` to `publish-shims.yml`'s `publish-go-tag` job `permissions:` block, based on a previous incident's fix (recorded in `.claude/agent-memory/archgate-developer/project_release_pipeline_gotchas.md`) intended to resolve a GitHub push-rejection error: `refusing to allow a GitHub App to create or update workflow ... without workflows permission`. The change passed code review and merged. `workflows` is not, and has never been, a valid `permissions:`-key scope — confirmed independently against GitHub's own live workflow-syntax documentation. The invalid key had been silently doing nothing since it was added. It surfaced only when a later PR's CodeRabbit review happened to run `actionlint` internally and flagged `unknown permission scope "workflows"` — this repository's own CI never would have caught it, because zizmor performs no schema validation of this kind.

### Alternatives Analysis

- **Rely on zizmor alone**: Already in place and valuable, but explicitly out of scope for schema correctness — see Problem Statement. Expanding zizmor's own rule set is not an option; schema validation is not its design goal, and its maintainers do not position it as a schema linter.
- **Rely on third-party review tooling (CodeRabbit, Cursor Bugbot) to catch this class of error**: This is what actually caught the PR #451 incident, but it is not a dependable control — third-party review tools are not guaranteed to run actionlint internally, their internal tooling is not something this project controls or can pin, and relying on an external reviewer's implementation detail to catch a class of bug this project could check directly is not a real enforcement strategy.
- **`reviewdog/action-actionlint`**: A maintained GitHub Action wrapping actionlint with reviewdog-style PR annotations. Rejected in favor of installing the actionlint binary directly: the reviewdog wrapper runs as a Docker container action, adding both a new third-party Action to this repository's trust surface (subject to [CI-001](./CI-001-pin-github-actions-by-hash.md)'s SHA-pinning requirement) and Docker-image execution overhead, for what is fundamentally a single static-check binary invocation. The direct-binary approach needs no `uses:` reference at all.
- **Manual periodic audits of workflow files**: Does not scale and has no enforcement mechanism — exactly the failure mode that let the PR #451 defect merge in the first place.

### Project-Specific Motivation

For the Archgate CLI, the release pipeline (`publish-shims.yml`, `release-binaries.yml`) is exercised far less frequently than the pull-request pipeline — some jobs run only once per release, weeks apart. A schema defect in a release-only job can sit dormant through many PR merges before it is ever executed for real, at which point it fails during an actual release rather than during routine development. Catching this class of defect on every PR, before merge, is strictly better than discovering it during a release.

## Decision

`.github/workflows/code-pull-request.yml` MUST run `actionlint` as a dedicated `actionlint` job, included as a required dependency of the `status` gate job (the single required status check for branch protection) — a hard blocker, not an advisory-only check.

**Installation**: `actionlint` MUST be installed by downloading the maintainer's prebuilt release binary via `rhysd/actionlint`'s own `scripts/download-actionlint.bash`, fetched from a specific 40-character commit SHA of that script (not a mutable branch reference), with an explicit pinned version argument (not `latest`):

```yaml
- name: Install actionlint
  run: |
    bash <(curl -fsSL "https://raw.githubusercontent.com/rhysd/actionlint/<40-char-sha>/scripts/download-actionlint.bash") <version>
- name: Run actionlint
  run: ./actionlint -color
```

This is a raw script fetch, not a `uses:` action reference — [CI-001](./CI-001-pin-github-actions-by-hash.md)'s automated `no-unpinned-actions` rule does not scan it — but the same reproducibility principle applies voluntarily: both the download script's commit and the actionlint version are pinned, exactly as CI-001 requires for actual `uses:` references.

**Scope**: This ADR covers only the decision to run `actionlint` as a hard-blocking CI job and how it is installed. It does not cover `zizmor` (governed by its own inline comments in `code-pull-request.yml`, not a formal ADR) and does not revise CI-001's `uses:`-pinning requirements.

**Relationship to [GEN-003](./GEN-003-tool-invocation-via-scripts.md)**: GEN-003 requires linting/formatting/validation to run through `package.json` scripts, but its Decision text and Do/Don't examples (`bunx prettier`, `bunx oxfmt`, `npx eslint`, `oxlint .`) — and its automated rule's own tool list (`prettier`, `oxfmt`, `oxlint`, `eslint`, `biome`) — are specifically about this project's own JS/TS toolchain. `actionlint` is a standalone external Go binary with no npm or `package.json` involvement at all, invoked directly in a CI job exactly as the pre-existing `zizmor` job invokes its own tool (via direct execution, not an npm script). GEN-003 does NOT apply to CI-only, non-npm-ecosystem static analysis tooling; no `package.json` wrapper script for `actionlint` is required or expected.

## Do's and Don'ts

### Do

- **DO** run `actionlint` as its own job in `.github/workflows/code-pull-request.yml`, listed in the `status` gate job's `needs:` array and result check
- **DO** pin the `download-actionlint.bash` fetch to a specific 40-character commit SHA in the raw.githubusercontent.com URL
- **DO** pin the actionlint version explicitly (e.g. `1.7.12`) — never `latest`
- **DO** set `persist-credentials: false` on the job's `actions/checkout` step, consistent with the `zizmor` job's pattern
- **DO** treat `actionlint` findings as hard blockers — unlike `zizmor`'s advisory carve-outs for fork PRs and its pre-existing findings backlog, `actionlint` starts from a clean slate and should stay that way
- **DO** re-resolve and update both the pinned script SHA and the actionlint version together when upgrading, the same way CI-001 requires for `uses:` references

### Don't

- **DON'T** add a `reviewdog/action-actionlint`-style wrapper Action — it adds Docker execution overhead and a new `uses:` trust surface for no capability this project needs beyond pass/fail
- **DON'T** treat `actionlint` findings as advisory-only — this ADR exists specifically because an advisory-only signal (a third-party reviewer's internal tooling) was the only thing that caught the motivating incident, and that is not a dependable control
- **DON'T** add a `package.json` script to wrap `actionlint` invocation under the belief that GEN-003 requires it — GEN-003 governs this project's own JS/TS toolchain, not external CI-only binaries
- **DON'T** fetch the `download-actionlint.bash` script from a branch ref (`main`) or omit the version argument (defaulting to `latest`) — both reintroduce the same class of non-reproducibility CI-001 exists to prevent for `uses:` references

## Consequences

### Positive

- **Catches the exact defect class that caused the motivating incident**: `actionlint` flags invalid `permissions:` scopes, malformed expressions, and shellcheck issues in `run:` blocks before merge, independent of whether a third-party review tool happens to run it
- **Complements, not duplicates, zizmor**: zizmor's security-pattern scanning and actionlint's schema validation cover disjoint failure classes; running both closes a real gap rather than adding redundant signal
- **No new third-party Action trust surface**: the direct-binary installation avoids adding a `uses:` reference, keeping CI-001's SHA-pinning surface unchanged
- **Reproducible tooling**: pinned script commit + pinned actionlint version means the exact same binary runs on every CI invocation until deliberately upgraded
- **Catches defects in rarely-executed release-pipeline jobs before they ever run for real**, closing the specific gap that let the PR #451 defect merge undetected

### Negative

- **Another CI job, another few seconds of pipeline time**: adds a small, fixed cost to every PR run (binary download + lint pass), though this is minor relative to the existing pipeline's total duration
- **Manual version bumps**: unlike a `uses:`-pinned Action, Renovate/Dependabot do not automatically propose updates for a pinned raw-script-URL-plus-version-argument pattern; upgrading `actionlint` requires a manual PR

### Risks

- **Stale actionlint version**: without automated dependency-update tooling watching this pattern, the pinned version can fall behind new actionlint releases (and their bug fixes or new schema checks).
  - **Mitigation:** Treat `actionlint` version bumps the same way CI-001 treats `uses:` SHA bumps — periodic manual review, checked during any broader CI/workflow maintenance pass.
- **A future contributor reintroduces the same class of error in a different workflow file added after this ADR**: `actionlint` runs against all `.github/workflows/*.yml` files by default (via `./actionlint` with no path argument), so this is unlikely, but a future refactor of the job's invocation could accidentally scope it to a subset of files.
  - **Mitigation:** Code review of any change to the `actionlint` job step MUST verify the invocation still covers the entire `.github/workflows/` directory with no path restriction.

## Compliance and Enforcement

### Automated Enforcement

- The `actionlint` job in `.github/workflows/code-pull-request.yml`, required by the `status` gate job, fails the pipeline on any `actionlint` finding.

### Manual Enforcement

Code reviewers MUST verify, for any change to the `actionlint` job:

1. The `scripts/download-actionlint.bash` fetch remains pinned to a specific 40-character commit SHA, not a branch reference
2. The actionlint version argument remains an explicit version, not `latest`
3. `actionlint` remains listed in the `status` gate job's `needs:` array and result check — removing it silently downgrades this from a hard blocker to a no-op
4. The job's invocation still scans the entire `.github/workflows/` directory, not a restricted subset

### Exceptions

None. If `actionlint` produces a false positive for a legitimate, GitHub-supported syntax it does not yet recognize, resolve by upgrading to a newer `actionlint` version first; if the false positive persists on the current version, escalate to the project maintainer and document the specific suppression (if any) in this ADR rather than silently disabling the job.

## References

- [CI-001: Pin GitHub Actions by Commit SHA](./CI-001-pin-github-actions-by-hash.md) — governs `uses:` reference pinning; this ADR applies the same reproducibility principle to a non-`uses:` script fetch
- [GEN-003: Tool Invocation via Package Scripts](./GEN-003-tool-invocation-via-scripts.md) — governs this project's own JS/TS toolchain invocation; does not apply to external CI-only tooling like `actionlint`
- [ARCH-006: Dependency Policy](./ARCH-006-dependency-policy.md) — general project minimalism philosophy informing the rejection of a wrapper Action in favor of direct binary installation
- `.claude/agent-memory/archgate-developer/project_release_pipeline_gotchas.md` — records the motivating incident and its correction
- [rhysd/actionlint](https://github.com/rhysd/actionlint) — the tool itself
- [GitHub Actions workflow syntax — `permissions`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) — the authoritative schema `actionlint` validates against
