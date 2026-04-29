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

GitHub Actions workflows reference third-party actions and reusable workflows via `uses:` declarations. These references can point to a mutable tag (e.g., `@v2`), a branch (e.g., `@main`), or an immutable commit SHA (e.g., `@a2bbfa25375fe432b6a289bc6b6cd05ecd0c4c32`). Tag and branch references are mutable — an upstream maintainer (or attacker who compromises the repository) can silently change the code that a tag points to. A SHA reference is immutable: it always resolves to the same tree, regardless of what happens to the upstream repository after the reference is recorded.

### Pain Points

Supply chain attacks targeting GitHub Actions are not theoretical:

- In March 2025, the `tj-actions/changed-files` action (used by 23,000+ repositories) was compromised via a stolen PAT. The attacker force-pushed malicious code to the `v35` tag, causing all workflows referencing `@v35` to execute the attacker's code — exfiltrating CI secrets to a public gist. Repositories that pinned by SHA were unaffected.
- In the same incident, the attacker pivoted to `reviewdog/action-setup`, a transitive dependency used by many linting actions, amplifying the blast radius across thousands of CI pipelines.
- The OSSF Scorecard project (which this repository runs via `.github/workflows/scorecard.yml`) explicitly flags tag-based references as a supply chain risk and scores repositories lower when unpinned dependencies are detected.

Without SHA pinning:

1. A compromised upstream tag can execute arbitrary code in CI with the permissions granted to the workflow (e.g., `contents: write`, `id-token: write`)
2. A silent tag update can change behavior between runs without any diff in the repository, making debugging impossible
3. OSSF Scorecard flags unpinned actions as medium-severity findings, degrading the project's security posture score

### Alternatives Analysis

**Tag pinning (e.g., `@v2`)**: The most common approach in the GitHub Actions ecosystem. Tags are human-readable and automatically receive patch updates. However, tags are mutable — they can be force-pushed to point to a different commit at any time. Major tags like `@v2` are routinely moved to track the latest minor release, meaning the code executing in CI changes without any corresponding change in the workflow file. This provides zero protection against supply chain attacks.

**Branch pinning (e.g., `@main`)**: Even less stable than tag pinning. The referenced code changes on every push to the branch. Useful only during development of a custom action, never for production workflows.

**SHA pinning with version comment (e.g., `@a2bbfa2...  # v4`)**: Immutable — the referenced tree cannot change after the commit is created. The version comment preserves human readability for upgrade decisions. Renovate and Dependabot both understand this format and can propose automated SHA bump PRs when new versions are released. This is the approach recommended by the OSSF Scorecard project, GitHub's own security hardening guide, and StepSecurity.

**Vendoring actions into the repository**: Copying the action source code into `.github/actions/` eliminates the external dependency entirely. This provides maximum isolation but creates a significant maintenance burden — vendored code must be manually updated, and transitive action dependencies must also be vendored. This approach does not scale for the 10+ third-party actions this project uses.

### Project-Specific Motivation

For the Archgate CLI, the release pipeline (`release-binaries.yml`) builds platform binaries, generates SLSA provenance attestations, and uploads signed artifacts to GitHub Releases. These workflows run with `contents: write`, `id-token: write`, and `attestations: write` permissions. A compromised action in this pipeline could inject malicious code into distributed binaries, sign them with valid SLSA provenance, and distribute them to all users via `npm install`. The blast radius of a supply chain attack on the release pipeline is the entire user base.

The project already pins most actions by SHA — the pattern was established early but was applied inconsistently. The SLSA reusable workflow in `release-binaries.yml` was referenced by tag (`@v2.1.0`) instead of SHA, which was flagged by OSSF Scorecard as a medium-severity finding. This ADR codifies the existing convention, closes the gap, and adds automated enforcement to prevent future regressions.

## Decision

All `uses:` references to third-party GitHub Actions and reusable workflows in `.github/workflows/*.yml` files MUST use a full 40-character commit SHA, followed by a version comment.

**Required format:**

```yaml
uses: owner/action@<40-char-sha> # <version>
```

**Scope:** This ADR covers all `uses:` declarations in GitHub Actions workflow files under `.github/workflows/`. It does NOT cover:

- Local workflow references (e.g., `uses: ./.github/workflows/smoke-test.yml`) — these reference the same repository and do not carry supply chain risk
- Local composite actions (e.g., `uses: ./.github/actions/my-action`) — same repository, same trust boundary
- Docker container references (e.g., `uses: docker://image:tag`) — governed by separate container image policies
- The SLSA reusable workflow `slsa-framework/slsa-github-generator/.github/workflows/*` — see "Carved-out exceptions" below

**Carved-out exceptions:**

- **`slsa-framework/slsa-github-generator/.github/workflows/*`** — The SLSA generator's bootstrap script (`generate-builder.sh`) extracts the version from the workflow ref to download the prebuilt builder binary from a GitHub release. It explicitly rejects non-tag refs with `Invalid ref: ... Expected ref of the form refs/tags/vX.Y.Z`. This is documented upstream as [slsa-framework/slsa-github-generator#150](https://github.com/slsa-framework/slsa-github-generator/issues/150). The reusable workflow MUST therefore be referenced by tag (e.g., `@v2.1.0`). Trust is anchored in the SLSA project's own signing/verification chain rather than in SHA pinning at the call site. Confirmed empirically: pinning by SHA broke the `v0.31.0` release pipeline (run [25107195589](https://github.com/archgate/cli/actions/runs/25107195589)).

**Version comment format:** The comment after the SHA MUST contain the human-readable version that the SHA corresponds to (e.g., `# v6`, `# v2.4.3`, `# v2.1.0`). This enables:

- Renovate and Dependabot to detect available updates and propose SHA bump PRs
- Human reviewers to quickly assess whether the action is current
- `git blame` to show when and why a version was changed

**Updating pinned actions:** When upgrading to a new version, look up the commit SHA for the target tag (e.g., via `gh api repos/owner/action/git/ref/tags/<tag> --jq '.object.sha'`) and update both the SHA and the version comment in a single commit.

## Do's and Don'ts

### Do

- **DO** pin every third-party `uses:` reference by full 40-character commit SHA
- **DO** include a `# <version>` comment after the SHA on the same line (e.g., `# v4`, `# v2.1.0`)
- **DO** use `gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq '.object.sha'` to resolve a tag to its commit SHA before adding a new action
- **DO** verify the SHA matches the expected tag before committing — cross-reference with the action's releases page
- **DO** enable Renovate or Dependabot for automated SHA update PRs — pinning without automated updates leads to stale dependencies
- **DO** audit the action's permissions requirements before adding a new third-party action to any workflow
- **DO** use local workflow references (`uses: ./.github/workflows/...`) for internal reusable workflows — no SHA pinning needed for same-repository references

### Don't

- **DON'T** reference third-party actions or reusable workflows by tag (e.g., `@v2`, `@v2.1.0`) — tags are mutable and can be silently changed
- **DON'T** reference third-party actions by branch (e.g., `@main`, `@master`) — branches change on every push
- **DON'T** omit the version comment after the SHA — without it, automated tools cannot propose version bump PRs and humans cannot assess currency
- **DON'T** use abbreviated SHAs (e.g., `@a2bbfa2`) — always use the full 40-character hash for unambiguous resolution
- **DON'T** pin local workflow references (e.g., `uses: ./.github/workflows/smoke-test.yml`) — these are same-repository and do not need SHA pinning

## Consequences

### Positive

- **Supply chain immutability**: SHA references cannot be silently changed by upstream maintainers or attackers — the exact code that runs in CI is recorded in the workflow file
- **OSSF Scorecard compliance**: Eliminates the Pinned-Dependencies finding, improving the project's security posture score
- **Audit trail**: Every action version change produces a visible diff in `git log`, enabling forensic analysis of CI pipeline changes
- **Reproducible builds**: The same workflow file always produces the same CI behavior, regardless of upstream releases
- **Automated update path**: Renovate and Dependabot understand the `@sha # version` format and can propose update PRs automatically
- **Defense in depth**: Complements the project's existing supply chain protections (SLSA provenance, Sigstore cosign, artifact attestations)

### Negative

- **Verbose workflow files**: SHA references are less readable than short tags — the version comment partially mitigates this but the lines are longer
- **Manual resolution required**: Adding a new action requires looking up the SHA for the desired tag, adding a step to the contributor workflow
- **Update friction without automation**: Without Renovate or Dependabot, pinned SHAs become stale and require manual bumps — potentially missing security patches in the actions themselves

### Risks

- **Stale action versions**: Pinned SHAs do not auto-update. If the project's automated dependency update tooling (Renovate) is disabled or misconfigured, actions may fall behind on security patches.
  - **Mitigation**: Renovate is configured in the repository and understands SHA-pinned GitHub Action references. The `renovate.json` configuration includes GitHub Actions as an update target. Regular Renovate PRs ensure pins stay current.
- **Incorrect SHA resolution**: A contributor might resolve the SHA for the wrong tag, or the tag might be an annotated tag whose SHA differs from the commit SHA.
  - **Mitigation**: The automated rule checks that all third-party `uses:` references match the `@<40-char-hex>` pattern. Code review MUST verify that the SHA matches the intended version by cross-referencing the action's releases page. For annotated tags, resolve the underlying commit via `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` and follow the `object` if `type` is `"tag"`.
- **Reusable workflow compatibility**: Some reusable workflow providers cannot be referenced by SHA. The SLSA GitHub Generator (`slsa-framework/slsa-github-generator/.github/workflows/*`) is the known case for this project — its bootstrap script reads the workflow ref to fetch the prebuilt builder from a GitHub release and rejects non-tag refs (upstream issue [#150](https://github.com/slsa-framework/slsa-github-generator/issues/150)). This was confirmed empirically when the `v0.31.0` release failed after SHA pinning.
  - **Mitigation**: The SLSA reusable workflow is carved out as a documented exception (see "Scope" above). It is referenced by tag (`@v2.1.0`). The automated `no-unpinned-actions` rule allowlists this specific path so the exception is enforced rather than being a silent gap. Any other provider claiming SHA pinning is unsupported MUST be evaluated on a case-by-case basis and added to the allowlist with an explicit justification before merging.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `CI-001/no-unpinned-actions`: Scans all `.github/workflows/*.yml` files for `uses:` lines referencing third-party actions or reusable workflows. Flags any reference that uses a tag, branch, or abbreviated SHA instead of a full 40-character commit SHA. Severity: `error` (hard blocker).

### Manual Enforcement

Code reviewers MUST verify:

1. Every new or updated `uses:` reference to a third-party action uses a full 40-character SHA
2. The version comment accurately reflects the tag the SHA was resolved from
3. The SHA was resolved from a trusted source (e.g., `gh api`, the action's GitHub releases page) — not copied from an untrusted PR or issue

### Exceptions

Local workflow and action references (`uses: ./.github/workflows/...` or `uses: ./.github/actions/...`) are exempt — they reference code in the same repository and are governed by the repository's own access controls. Docker container references (`uses: docker://...`) are also exempt from this ADR.

The SLSA reusable workflow (`slsa-framework/slsa-github-generator/.github/workflows/*`) is exempt because its bootstrap script requires a tag-format ref to fetch the builder binary; see "Carved-out exceptions" under Decision. The `no-unpinned-actions` rule explicitly allowlists this path.

For any other third-party reference where an upstream provider claims SHA pinning is unsupported: escalate to the project maintainer, document the upstream limitation in this ADR's "Carved-out exceptions" list, and update the rule allowlist before merging. Silent exceptions are not permitted.

## References

- [ARCH-006: Dependency Policy](./ARCH-006-dependency-policy.md) — Governs runtime dependency minimization and supply chain policy; this ADR extends supply chain protections to CI dependencies
- [GEN-003: Tool Invocation via Package Scripts](./GEN-003-tool-invocation-via-scripts.md) — Standardizes how tools are invoked; workflows MUST use `bun run validate` rather than invoking tools directly
- [GitHub Security Hardening Guide — Using third-party actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions)
- [OSSF Scorecard — Pinned-Dependencies check](https://github.com/ossf/scorecard/blob/main/docs/checks.md#pinned-dependencies)
- [StepSecurity — Secure GitHub Actions workflows](https://app.stepsecurity.io/)
- [tj-actions/changed-files supply chain attack analysis (March 2025)](https://www.stepsecurity.io/blog/analysis-of-tj-actions-changed-files-incident)
