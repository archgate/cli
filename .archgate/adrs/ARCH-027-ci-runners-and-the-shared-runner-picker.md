---
id: ARCH-027
title: CI Runners and the Shared Runner Picker
domain: architecture
rules: true
files:
  - ".github/workflows/*.yml"
  - ".github/workflows/*.yaml"
  - "**/action.yml"
  - "**/action.yaml"
  - ".archgate/repository.json"
---

# CI Runners and the Shared Runner Picker

## Context

The `barretotech` enterprise (the `archgate`, `jack-for-work` and `BarretoTech` organizations) shares one pool of self-hosted runners on TatuiCloud: Linux runners labelled `tatuicloud`, merge-queue runners labelled `tatuicloud-merge-queue`, and ephemeral Windows VMs labelled `tatuicloud-windows`. GitHub has no fallback for a busy self-hosted label, so a job sent straight to a full pool waits for as long as the pool stays full.

The capacity service `ci-capacity` (on TatuiCloud's `ci-cache`) answers, per job, where it should run. It picks the first of these that fits: a free self-hosted runner, a Blacksmith runner while the organization's free Blacksmith minutes last, GitHub-hosted while the included Actions minutes last, or a wait for the self-hosted pool. A runner it hands out is held for 60 seconds. GitHub knows nothing of that hold, so a job that targets a self-hosted label without asking can take the runner the service just gave another job.

Jobs ask through the public action `barretotech/runner-picker`, which joins the tailnet with a federated identity and queries the service. The organization variables `RUNNER_CAPACITY_URL` and `TAILNET_CLIENT_ID_PICKER` exist only for private and internal repositories.

A routed Linux job can land on any of three machines that are not alike: a TatuiCloud runner (a Debian 13 container), a Blacksmith runner (Ubuntu 24.04) or GitHub-hosted `ubuntu-latest`. GitHub's Ubuntu 24.04 and 26.04 images set `kernel.apparmor_restrict_unprivileged_userns=1`, so an unprivileged user namespace (`unshare --map-root-user`, rootless containers, bubblewrap, Chromium's sandbox) fails there with `write failed /proc/self/uid_map: Operation not permitted`. TatuiCloud and Blacksmith leave the restriction off. A test that needs a namespace then passes or fails depending on where the picker sent the job.

GitHub-hosted minutes cost nothing for public repositories, and a self-hosted runner that serves a public repository runs code from any fork's pull request.

## Decision

1. Public repositories use GitHub-hosted runners only.
2. Private and internal build, test and deploy jobs ask a dedicated picker on `ubuntu-slim` and consume its `runs-on` output with a fallback. The TatuiCloud jobs listed below use GitHub-hosted runners to preserve network isolation.
3. Use `barretotech/runner-picker` pinned to a full SHA, with `source: service`, `capacity-url: ${{ vars.RUNNER_CAPACITY_URL }}` and `tailnet-client-id: ${{ vars.TAILNET_CLIENT_ID_PICKER }}`.
4. Linux offers Blacksmith first, then `hosted: ${{ vars.HOSTED_LINUX_RUNNER || '"ubuntu-latest"' }}` with `weight: ${{ vars.HOSTED_LINUX_WEIGHT || 1 }}`. Before using a Linux weight other than 1, deploy and verify matching SKU accounting in ci-capacity; until then keep the standard hosted offer and weight 1. Windows offers `"windows-latest"` at weight 2 without Blacksmith; macOS offers `"macos-latest"` at weight 10. Configuration and accounting details below are part of this policy.
5. Jobs taking seconds, including pickers, run directly on `ubuntu-slim`.
6. A job whose purpose is the self-hosted machine itself may target its label directly, with `# runner-picker: exempt - <reason>` immediately before `runs-on`.
7. Routed jobs behave the same on every pool. Linux-capable jobs first lift the hosted user-namespace restriction on GitHub-hosted Linux only, using the step below. Close other pool differences on the runner side or in this ADR.

## Runner policy details

1. **Public repositories run on GitHub-hosted runners only.** They never name a self-hosted label, a Blacksmith label, or the runner picker.
2. **Private and internal repositories ask the runner picker for every job that builds, tests or deploys.** The picker job runs on `ubuntu-slim` and the consuming job reads its `runs-on` output, with a fallback for when the picker gives no answer.

   In `BarretoTech/tatuicloud`, the `line-endings`, `shell`, `ansible` and `tofu` jobs in `.github/workflows/ci.yml` run on GitHub-hosted runners without a route to the homelab and use no deployment credentials. The `apply` job in `.github/workflows/tailnet.yml` also runs on GitHub-hosted and uses the API-scoped OIDC identity from its protected `tailnet` environment. These five jobs are the TatuiCloud network-isolation exception to picker routing.

3. **One action, one pin.** The picker is `barretotech/runner-picker`, pinned to a full commit SHA with its release tag as a comment, and called with `source: service`, `capacity-url: ${{ vars.RUNNER_CAPACITY_URL }}` and `tailnet-client-id: ${{ vars.TAILNET_CLIENT_ID_PICKER }}`.
4. **Overflow order per platform.** Linux offers `"blacksmith-2vcpu-ubuntu-2404"` as `overflow`. Its GitHub-hosted offer and billing weight come from organization variables, with standard-runner defaults:

   ```yaml
   hosted: ${{ vars.HOSTED_LINUX_RUNNER || '"ubuntu-latest"' }}
   weight: ${{ vars.HOSTED_LINUX_WEIGHT || 1 }}
   ```

   `HOSTED_LINUX_RUNNER` is a JSON string or array, as required by runner-picker v1.0.0; `HOSTED_LINUX_WEIGHT` is a positive integer. An organization with a 4-core Ubuntu larger runner named `ubuntu-4core` sets them to `"ubuntu-4core"` (including the JSON quotes) and `2`. The runner must be accessible to the consuming repositories. Values must match the picker's input validation: a JSON string or nonempty label array for the runner, and an integer from 1 to 999999 for the weight. A bare `ubuntu-4core` without JSON quotes, or a weight such as `0`, `2.0` or `2`, produces an error annotation but a successful picker step with self-hosted fallback: hosted overflow is lost and the job waits for the pool. Keep the JSON form to support both string and array targets. Organizations without that runner leave both unset. This applies to the picker's `hosted` offer; the consuming job's no-answer fallback is a separate choice.

   The picker sends `weight` to ci-capacity, which allows GitHub-hosted only when `remaining - weight × JOB_MINUTES >= RESERVE_MINUTES`: with the defaults of 30 estimated job minutes and a 5,000-minute reserve, weight 2 requires at least 5,060 remaining minutes. This is an admission estimate, not a minute reservation; billing ingestion counts usage separately. **A Linux weight other than 1 requires ci-capacity's usage ledger to apply the same price ratio to the corresponding hosted SKU before routing jobs to it.** For `ubuntu-4core`, ingestion must count each `linux_4_core` minute as 2 standard Linux minutes. Until that accounting is deployed and verified, keep the standard Linux hosted offer and weight 1. Setting the organization variables alone does not satisfy this prerequisite. A ledger that counts 4-core minutes at 1 overstates the enterprise-wide remaining allowance, so the admission arithmetic cannot protect the 5,000-minute reserve for any organization. Blacksmith checks its own label-derived rate independently.

   Windows offers `"windows-latest"` with `weight: 2` and no Blacksmith runner. macOS offers `"macos-latest"` with `weight: 10`.

5. **Jobs that take seconds run on `ubuntu-slim` directly.** Examples are commit lint, an Archgate check on its own, notifications and the picker job itself.
6. **A job whose purpose is the self-hosted machine itself targets its label directly**, such as warming or probing a self-hosted cache, or a deploy that only the private network can reach. The line before its `runs-on` carries `# runner-picker: exempt - <reason>`.
7. **A routed job behaves the same on every runner it can land on.** A routed job that can run on Linux lifts the hosted images' user-namespace restriction in its first step, on GitHub-hosted Linux only:

   ```yaml
   - name: Allow unprivileged user namespaces
     if: runner.os == 'Linux' && runner.environment == 'github-hosted'
     run: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
   ```

   Any other difference found between the pools is closed on the runner side or in this ADR, not by sending one job to one pool.

## Do's and Don'ts

### Do

- **DO** give the picker job `permissions: { id-token: write }` at job level, `timeout-minutes: 3`, and `runs-on: ubuntu-slim`.
- **DO** write the consuming job's `runs-on` as `${{ fromJSON(needs.<picker>.outputs.runs-on || <fallback>) }}` and its condition as `!cancelled() && ...`, so a skipped or failed picker still runs the job.
- **DO** give every consuming job its own picker job; jobs sharing one picker output can all be sent to the one runner the service is holding. Prefer a separate job per platform, each needing only its own picker: a matrix job waits for every picker it needs, and a slow one lets another leg's held runner go. A matrix job may still route each leg through its own picker, for example `matrix.os == 'windows' && (needs.windows-runner.outputs.runs-on || <fallback>) || needs.linux-runner.outputs.runs-on || <fallback>`.
- **DO** skip the picker only for pull requests from forks, which cannot mint the tailnet identity: `github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository`. Every other event runs it.
- **DO** start every routed job that can run on Linux with the "Allow unprivileged user namespaces" step of Decision 7, before any setup step. A job routed only to Windows or macOS needs none.
- **DO** keep the action pinned by full SHA. Verify the SHA against `barretotech/runner-picker`'s release tag when adopting or upgrading it.

### Don't

- **DON'T** write a self-hosted, `tatuicloud*` or `blacksmith-*` label, or a `vars.*RUNNER` variable, in `runs-on` without reading a picker output, unless the job is marked exempt.
- **DON'T** use any other runner-picker action, a tag such as `@v1`, or `source: github`.
- **DON'T** use self-hosted runners, Blacksmith or the picker in a public repository.
- **DON'T** fix a test that fails on one pool by pinning its job to another pool, or by skipping the test on GitHub-hosted runners.

## Consequences

### Positive

- A full pool overflows to Blacksmith or GitHub-hosted instead of queueing, within the free minutes of each.
- A routed job runs where the service sent it, so the service's view of the pool stays accurate apart from fallbacks and exempt jobs (see Risks).
- One pinned action across the enterprise means one upgrade path and one place to audit.
- A job's result does not depend on which pool the capacity service picked.

### Negative

- Every routed job waits for a picker job of about 5 to 10 seconds.
- A workflow gains a job and a `needs` edge for each platform it routes.
- Every routed Linux job carries one extra step, a no-op off GitHub-hosted runners.

### Risks

- **The service is unreachable.** The picker answers self-hosted with "no answer from the capacity service", and the job waits for the pool. The TatuiCloud watchdog opens an incident when picker jobs fall back.
- **Exemptions spread.** An exempt job takes runners without asking. Each exemption carries its reason on the line before `runs-on`.
- **The images drift.** A new GitHub-hosted image can add another restriction the other pools lack. The step covers user namespaces only; a new difference shows as a job that fails on one pool alone, and is added to Decision 7.
- **Fallbacks bypass the service.** A job whose picker was skipped (a fork's pull request) or gave no answer runs on its fallback. A self-hosted fallback then takes the first free runner, which can be one the service is holding for another job. A hosted fallback avoids that, at the cost of included minutes.

## Compliance and Enforcement

The companion rules read every workflow and every composite action (`action.yml` anywhere in the repository) as YAML, so comments never count:

- `picker-pin`: any `runner-picker` action, with or without a subpath, is `barretotech/runner-picker@<40-hex SHA>`.
- `picker-service`: each picker step's `with:` sets `source: service`, `capacity-url: ${{ vars.RUNNER_CAPACITY_URL }}` and `tailnet-client-id: ${{ vars.TAILNET_CLIENT_ID_PICKER }}`.
- `routed-runs-on`: each unit of a job's `runs-on` (the string, each list label, each `group`/`labels` field), each input of a reusable-workflow call, and each matrix value it reads is checked on its own; a unit that names a self-hosted, `tatuicloud*` or `blacksmith-*` label or a `vars.*RUNNER` or `vars.*RUNNER_*` variable (dotted or `vars['...']`) takes its runner from picker jobs: it reads at least one `needs.<job>.outputs.runs-on`, each such `<job>` is in the job's `needs`, forwards its picker step's output as `outputs.runs-on: ${{ steps.<id>.outputs.runs-on }}`, and has an `if:` that is absent or reads context (a constant one such as `true`, `false` or `${{ 1 > 2 }}` either never runs or guards nothing, so it does not count), no pool label or runner variable comes before the first of them, and each is followed by a `||` fallback and is neither combined with `&&` nor compared, in or out of parentheses. Only the output named exactly `runs-on` counts. Matrix values read by `matrix.<key>` or `matrix['<key>']`, and a matrix built by an expression, are checked too. Any job reading a picker output needs that fallback, pool or not. `needs.<job>.outputs['runs-on']` reads the same output. A matrix job may read one picker per leg, and a matrix value may carry a picker output; a matrix value that names the pool without one is a label used directly. The exemption marker on the line before a block `runs-on:` key waives it; a job written as a flow mapping cannot be exempt. A workflow that does not parse as YAML is a violation, and the other files are still checked.
- `picker-service` (Linux hosted inputs): every picker whose self-hosted labels do not identify only Windows or macOS sets `hosted: ${{ vars.HOSTED_LINUX_RUNNER || '"ubuntu-latest"' }}` and `weight: ${{ vars.HOSTED_LINUX_WEIGHT || 1 }}`. Omitted platform labels default to Linux. If `self-hosted` is a direct matrix reference (for example `${{ matrix.labels }}` or `${{ matrix['labels'] }}`), the rule skips the two Linux-specific checks because it cannot resolve the platform; source, capacity URL and tailnet identity are still enforced. Review such pickers at the call site: each Linux matrix leg supplies the organization-variable expressions above, while Windows and macOS legs retain their platform offers and weights. Other expressions, including `${{ vars.LINUX_LABELS }}` and literal Linux labels wrapped in an expression, still require both Linux inputs. Both inputs are enforced together, including in composite actions.
- `hosted-userns`: a job that reads a picker's `runs-on` output, in its `runs-on` or a matrix value it reads, and has a unit that does not name only Windows or macOS runners, has a first step whose `run` holds `sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`. A reusable-workflow call is not checked; the called workflow's jobs are.
- `public-hosted-only`: `.archgate/repository.json` records the repository's visibility (`public`, `private` or `internal`), and a missing file, invalid JSON or an unknown visibility is a violation, each reported as such. In a public repository, no step uses a runner picker and no job targets a self-hosted or Blacksmith runner or a runner group, exempt or not. A change to the visibility record re-checks every workflow. The enterprise-adrs Sync workflow writes the file from GitHub's record of the repository.

GitHub limits what a public workflow that breaks the rule can reach, without rejecting the workflow itself: the enterprise runner group `tatuicloud` does not serve public repositories, so a job naming its labels never gets a runner, and the picker's organization variables are visible to private and internal repositories only, so a picker step there has no service to ask. `public-hosted-only` is what rejects such a workflow.

The rules check pool labels. During review, verify that directly hosted private and internal jobs meet the short-job policy or the TatuiCloud network-isolation exception. For the exception, match both the workflow path and job ID, and verify that the validation jobs use no deployment credentials and that the apply job uses the protected `tailnet` environment.

## References

- [`barretotech/runner-picker`](https://github.com/barretotech/runner-picker)
- TatuiCloud runbook, "Runner overflow" (`BarretoTech/tatuicloud` `docs/runbook.md`)
