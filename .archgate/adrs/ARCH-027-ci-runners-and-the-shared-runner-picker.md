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

1. **Public repositories run on GitHub-hosted runners only.** They never name a self-hosted label, a Blacksmith label, or the runner picker.
2. **Private and internal repositories ask the runner picker for every job that builds, tests or deploys.** The picker job runs on `ubuntu-slim` and the consuming job reads its `runs-on` output, with a fallback for when the picker gives no answer.
3. **One action, one pin.** The picker is `barretotech/runner-picker`, pinned to a full commit SHA with its release tag as a comment, and called with `source: service`, `capacity-url: ${{ vars.RUNNER_CAPACITY_URL }}` and `tailnet-client-id: ${{ vars.TAILNET_CLIENT_ID_PICKER }}`.
4. **Overflow order per platform.** Linux offers `"blacksmith-2vcpu-ubuntu-2404"` as `overflow` and `"ubuntu-latest"` as `hosted`. Windows offers `"windows-latest"` with `weight: 2` and no Blacksmith runner. macOS offers `"macos-latest"` with `weight: 10`.
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
- `hosted-userns`: a job that reads a picker's `runs-on` output, in its `runs-on` or a matrix value it reads, and has a unit that does not name only Windows or macOS runners, has a first step whose `run` holds `sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`. A reusable-workflow call is not checked; the called workflow's jobs are.
- `public-hosted-only`: `.archgate/repository.json` records the repository's visibility (`public`, `private` or `internal`), and a missing file, invalid JSON or an unknown visibility is a violation, each reported as such. In a public repository, no step uses a runner picker and no job targets a self-hosted or Blacksmith runner or a runner group, exempt or not. A change to the visibility record re-checks every workflow. The enterprise-adrs Sync workflow writes the file from GitHub's record of the repository.

GitHub limits what a public workflow that breaks the rule can reach, without rejecting the workflow itself: the enterprise runner group `tatuicloud` does not serve public repositories, so a job naming its labels never gets a runner, and the picker's organization variables are visible to private and internal repositories only, so a picker step there has no service to ask. `public-hosted-only` is what rejects such a workflow.

The rules check the pool side of the decision: a job that names no self-hosted, `tatuicloud*` or `blacksmith-*` runner is not checked, so whether a private repository's build job on a hosted label should ask the picker instead is left to review.

## References

- [`barretotech/runner-picker`](https://github.com/barretotech/runner-picker)
- TatuiCloud runbook, "Runner overflow" (`BarretoTech/tatuicloud` `docs/runbook.md`)
