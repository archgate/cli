---
id: CI-001
title: Pin GitHub Actions by Commit SHA
domain: ci
rules: true
files:
  - ".github/workflows/*.yml"
---

## Context

### Problem Statement

GitHub Actions workflows reference third-party actions and reusable workflows via `uses:` declarations, which can point to a mutable tag (e.g. `@v2`), a branch (e.g. `@main`), or an immutable commit SHA (e.g. `@a2bbfa25375fe432b6a289bc6b6cd05ecd0c4c32`). An upstream maintainer — or an attacker who compromises the repository — can silently change what a tag or branch resolves to. A SHA reference always resolves to the same tree.

### Pain Points

Supply chain attacks targeting GitHub Actions are not theoretical: the `tj-actions/changed-files` compromise (March 2025, 23,000+ dependent repositories) force-pushed malicious code onto the `v35` tag and exfiltrated CI secrets from every workflow referencing `@v35`, then pivoted to the transitive `reviewdog/action-setup` to amplify the blast radius. Repositories that pinned by SHA were unaffected. OSSF Scorecard — which this repository runs via `.github/workflows/scorecard.yml` — flags tag-based references as a supply chain risk and scores unpinned repositories lower.

Without SHA pinning:

1. A compromised upstream tag executes arbitrary code in CI with the permissions granted to the workflow (e.g. `contents: write`, `id-token: write`)
2. A silent tag update changes behavior between runs with no diff in the repository, making debugging impossible
3. OSSF Scorecard flags unpinned actions as medium-severity findings, degrading the project's security posture score

### Alternatives Analysis

- **Tag pinning (e.g. `@v2`)**: human-readable and picks up patches automatically, but tags are mutable and major tags are routinely re-pointed to track the latest minor release — the code executing in CI changes with no corresponding workflow diff, giving zero supply chain protection
- **Branch pinning (e.g. `@main`)**: the referenced code changes on every upstream push; useful only while developing a custom action, never for production workflows
- **SHA pinning with version comment (e.g. `@a2bbfa2... # v4.2.1`)**: immutable, preserves human-readable version context for upgrade decisions, and is understood by Renovate and Dependabot for automated SHA bump PRs — the approach recommended by OSSF Scorecard, GitHub's own security hardening guide, and StepSecurity
- **Vendoring actions into `.github/actions/`**: maximum isolation, but vendored code and its transitive action dependencies must be updated by hand — does not scale to the number of third-party actions this project uses

### Project-Specific Motivation

The release pipeline (`release-binaries.yml`) builds platform binaries, generates SLSA provenance attestations, and uploads signed artifacts to GitHub Releases, running with `contents: write`, `id-token: write`, and `attestations: write` permissions. A compromised action there could inject malicious code into distributed binaries, sign them with valid SLSA provenance, and ship them to every user via `npm install`. The blast radius of a supply chain attack on the release pipeline is the entire user base.

## Decision

All `uses:` references to third-party Actions and reusable workflows in `.github/workflows/*.yml` MUST use a full 40-character commit SHA, followed by a version comment:

```yaml
uses: owner/action@<40-char-sha> # <version>
```

**Scope:** all `uses:` declarations under `.github/workflows/`. NOT covered:

- Local workflow and composite action references (e.g. `uses: ./.github/workflows/smoke-test.yml`, `uses: ./.github/actions/my-action`) — same repository, same trust boundary
- Docker container references (e.g. `uses: docker://image:tag`) — governed by separate container image policies

**Carved-out exceptions:**

- **`slsa-framework/slsa-github-generator/.github/workflows/*`** — its bootstrap script `generate-builder.sh` reads the version from the workflow ref to download the prebuilt builder binary and rejects non-tag refs (`Invalid ref: ... Expected ref of the form refs/tags/vX.Y.Z`; upstream [issue #150](https://github.com/slsa-framework/slsa-github-generator/issues/150)). It MUST be referenced by tag (e.g. `@v2.1.0`); trust is anchored in the SLSA project's own signing/verification chain, not in SHA pinning at the call site.

**Version comment format:** the comment MUST contain the **exact tag** the SHA was resolved from (e.g. `# v2.4.3`, `# v5.5.0`). Floating major-version comments (`# v5`, `# v7`) are prohibited — major tags are re-pointed on every minor/patch release, so the comment silently stops matching the pinned SHA and zizmor reports `ref-version-mismatch`. Starting from a floating tag, look up the exact release tag pointing at the same commit and record that. The comment lets Renovate/Dependabot propose SHA bumps, reviewers assess currency, and `git blame` explain version changes.

**Updating pinned actions:** resolve the target tag to its **commit** SHA — annotated tags need a dereferencing step (see Do's) — and update SHA and version comment in a single commit.

## Do's and Don'ts

### Do

- **DO** pin every third-party `uses:` reference by full 40-character commit SHA
- **DO** include a `# <version>` comment after the SHA on the same line, using the exact tag the SHA resolves to (e.g. `# v2.1.0`, `# v5.5.0`), never a floating major tag
- **DO** resolve a tag to a **commit** SHA before adding a new action: `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`; when `.object.type` is `"tag"` (annotated tag), the SHA is a tag object — dereference it via `gh api repos/<owner>/<repo>/git/tags/<sha> --jq '.object.sha'`
- **DO** verify the SHA matches the expected tag before committing — cross-reference the action's releases page
- **DO** enable Renovate or Dependabot for automated SHA update PRs — pinning without automated updates leads to stale dependencies
- **DO** audit an action's permissions requirements before adding it to any workflow
- **DO** use local workflow references (`uses: ./.github/workflows/...`) for internal reusable workflows — no SHA pinning needed for same-repository references

### Don't

- **DON'T** reference third-party actions or reusable workflows by tag (e.g. `@v2`, `@v2.1.0`) — tags are mutable and can be silently changed
- **DON'T** reference third-party actions by branch (e.g. `@main`, `@master`) — branches change on every push
- **DON'T** omit the version comment after the SHA — without it, automated tools cannot propose version bump PRs and humans cannot assess currency
- **DON'T** use a floating major-version comment (e.g. `# v5`) — the major tag moves with upstream releases, the comment goes stale against the pinned SHA, and zizmor reports `ref-version-mismatch`
- **DON'T** use abbreviated SHAs (e.g. `@a2bbfa2`) — always use the full 40-character hash for unambiguous resolution
- **DON'T** pin local workflow references (e.g. `uses: ./.github/workflows/smoke-test.yml`) — same repository, no SHA pinning needed

## Consequences

### Positive

- **Supply chain immutability**: SHA references cannot be silently changed upstream — the exact code that runs in CI is recorded in the workflow file
- **OSSF Scorecard compliance**: eliminates the Pinned-Dependencies finding, improving the security posture score
- **Audit trail**: every action version change produces a visible diff in `git log`, enabling forensic analysis of CI pipeline changes
- **Reproducible builds**: the same workflow file always produces the same CI behavior, regardless of upstream releases
- **Automated update path**: Renovate and Dependabot understand the `@sha # version` format and propose update PRs automatically
- **Defense in depth**: complements the project's existing supply chain protections (SLSA provenance, Sigstore cosign, artifact attestations)

### Negative

- **Verbose workflow files**: SHA references are less readable than short tags; the version comment only partially mitigates this
- **Manual resolution required**: adding a new action requires looking up the SHA for the desired tag, adding a step to the contributor workflow
- **Update friction without automation**: without Renovate or Dependabot, pins go stale and require manual bumps — potentially missing security patches in the actions themselves

### Risks

- **Stale action versions**: pinned SHAs do not auto-update, so if the automated dependency update tooling is disabled or misconfigured, actions fall behind on security patches.
  - **Mitigation**: Renovate is configured in the repository, understands SHA-pinned GitHub Action references, and `renovate.json` includes GitHub Actions as an update target; regular Renovate PRs keep pins current.
- **Incorrect SHA resolution**: a contributor may resolve the SHA for the wrong tag, or use an annotated tag whose object SHA differs from the commit SHA.
  - **Mitigation**: The automated rule checks shape only — a tag-object SHA is also 40 hex characters and passes it. Code review MUST verify the SHA matches the intended version by cross-referencing the action's releases page, and that annotated tags were dereferenced per the Do's (e.g. `pypa/gh-action-pypi-publish`, used in this repo, publishes annotated release tags whose ref SHA is a tag object, not the commit).
- **Reusable workflow compatibility**: some reusable workflow providers cannot be referenced by SHA. The SLSA GitHub Generator is the known case — its bootstrap script reads the workflow ref to fetch the prebuilt builder and rejects non-tag refs (upstream [#150](https://github.com/slsa-framework/slsa-github-generator/issues/150)); SHA pinning it broke the `v0.31.0` release pipeline (run [25107195589](https://github.com/archgate/cli/actions/runs/25107195589)).
  - **Mitigation**: The SLSA reusable workflow is a documented carve-out referenced by tag (`@v2.1.0`), and the `no-unpinned-actions` rule allowlists that specific path so the exception is enforced rather than a silent gap. Any other provider claiming SHA pinning is unsupported MUST be evaluated case by case and added to the allowlist with an explicit justification before merging.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `CI-001/no-unpinned-actions`: scans all `.github/workflows/*.yml` files for `uses:` lines referencing third-party actions or reusable workflows, and flags any reference using a tag, branch, or abbreviated SHA instead of a full 40-character commit SHA. Severity: `error` (hard blocker). **Known limitation:** the rule verifies the 40-hex shape only — it cannot verify offline that the SHA names a commit rather than an annotated tag object, so the dereferencing requirement in the Do's is enforced by code review, not by the rule.

### Manual Enforcement

Code reviewers MUST verify:

1. Every new or updated `uses:` reference to a third-party action uses a full 40-character SHA
2. The version comment accurately reflects the tag the SHA was resolved from
3. The SHA was resolved from a trusted source (e.g. `gh api`, the action's GitHub releases page) — not copied from an untrusted PR or issue

### Exceptions

Local workflow and action references (`uses: ./.github/workflows/...`, `uses: ./.github/actions/...`) are exempt — same repository, governed by the repository's own access controls. Docker container references (`uses: docker://...`) are also exempt.

The SLSA reusable workflow (`slsa-framework/slsa-github-generator/.github/workflows/*`) is exempt because its bootstrap script requires a tag-format ref to fetch the builder binary; see "Carved-out exceptions" under Decision. The `no-unpinned-actions` rule explicitly allowlists this path.

For any other third-party reference where an upstream provider claims SHA pinning is unsupported: escalate to the project maintainer, document the upstream limitation in this ADR's "Carved-out exceptions" list, and update the rule allowlist before merging. Silent exceptions are not permitted.

## References

- [ARCH-006: Dependency Policy](./ARCH-006-dependency-policy.md) — Governs runtime dependency minimization and supply chain policy; this ADR extends supply chain protections to CI dependencies
- [GEN-003: Tool Invocation via Package Scripts](./GEN-003-tool-invocation-via-scripts.md) — Standardizes how tools are invoked; workflows MUST use `bun run validate` rather than invoking tools directly
- [GitHub Security Hardening Guide — Using third-party actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions)
- [OSSF Scorecard — Pinned-Dependencies check](https://github.com/ossf/scorecard/blob/main/docs/checks.md#pinned-dependencies)
- [StepSecurity — Secure GitHub Actions workflows](https://app.stepsecurity.io/)
- [tj-actions/changed-files supply chain attack analysis (March 2025)](https://www.stepsecurity.io/blog/analysis-of-tj-actions-changed-files-incident)
