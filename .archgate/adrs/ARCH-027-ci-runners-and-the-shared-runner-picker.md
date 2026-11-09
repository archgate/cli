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
---

# CI Runners and the Shared Runner Picker

## Context

The archgate enterprise (the `archgate` and `jack-for-work` organizations) shares one pool of self-hosted runners on TatuiCloud: Linux runners labelled `tatuicloud`, merge-queue runners labelled `tatuicloud-merge-queue`, and ephemeral Windows VMs labelled `tatuicloud-windows`. GitHub has no fallback for a busy self-hosted label, so a job sent straight to a full pool waits for as long as the pool stays full.

The capacity service `ci-capacity` (on TatuiCloud's `ci-cache`) answers, per job, where it should run. It picks the first of these that fits: a free self-hosted runner, a Blacksmith runner while the organization's free Blacksmith minutes last, GitHub-hosted while the included Actions minutes last, or a wait for the self-hosted pool. A runner it hands out is held for 60 seconds. GitHub knows nothing of that hold, so a job that targets a self-hosted label without asking can take the runner the service just gave another job.

Jobs ask through the public action `barretotech/runner-picker`, which joins the tailnet with a federated identity and queries the service. The organization variables `RUNNER_CAPACITY_URL` and `TAILNET_CLIENT_ID_PICKER` exist only for private and internal repositories.

GitHub-hosted minutes cost nothing for public repositories, and a self-hosted runner that serves a public repository runs code from any fork's pull request.

## Decision

1. **Public repositories run on GitHub-hosted runners only.** They never name a self-hosted label, a Blacksmith label, or the runner picker.
2. **Private and internal repositories ask the runner picker for every job that builds, tests or deploys.** The picker job runs on `ubuntu-slim` and the consuming job reads its `runs-on` output, with a fallback for when the picker gives no answer.
3. **One action, one pin.** The picker is `barretotech/runner-picker`, pinned to a full commit SHA with its release tag as a comment, and called with `source: service`, `capacity-url: ${{ vars.RUNNER_CAPACITY_URL }}` and `tailnet-client-id: ${{ vars.TAILNET_CLIENT_ID_PICKER }}`.
4. **Overflow order per platform.** Linux offers `"blacksmith-2vcpu-ubuntu-2404"` as `overflow` and `"ubuntu-latest"` as `hosted`. Windows offers `"windows-latest"` with `weight: 2` and no Blacksmith runner. macOS offers `"macos-latest"` with `weight: 10`.
5. **Jobs that take seconds run on `ubuntu-slim` directly.** Examples are commit lint, an Archgate check on its own, notifications and the picker job itself.
6. **A job whose purpose is the self-hosted machine itself targets its label directly**, such as warming or probing a self-hosted cache, or a deploy that only the private network can reach. The line before its `runs-on` carries `# runner-picker: exempt - <reason>`.

## Do's and Don'ts

### Do

- **DO** give the picker job `permissions: { id-token: write }` at job level, `timeout-minutes: 3`, and `runs-on: ubuntu-slim`.
- **DO** write the consuming job's `runs-on` as `${{ fromJSON(needs.<picker>.outputs.runs-on || <fallback>) }}` and its condition as `!cancelled() && ...`, so a skipped or failed picker still runs the job.
- **DO** skip the picker only for pull requests from forks, which cannot mint the tailnet identity: `github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository`. Every other event runs it.
- **DO** keep the action pinned by full SHA. Verify the SHA against `barretotech/runner-picker`'s release tag when adopting or upgrading it.

### Don't

- **DON'T** write a self-hosted, `tatuicloud*` or `blacksmith-*` label, or a `vars.*RUNNER` variable, in `runs-on` without reading a picker output, unless the job is marked exempt.
- **DON'T** use any other runner-picker action, a tag such as `@v1`, or `source: github`.
- **DON'T** use self-hosted runners, Blacksmith or the picker in a public repository.

## Consequences

### Positive

- A full pool overflows to Blacksmith or GitHub-hosted instead of queueing, within the free minutes of each.
- No job takes a runner the service has handed to another job, so the service's view of the pool stays accurate.
- One pinned action across the enterprise means one upgrade path and one place to audit.

### Negative

- Every routed job waits for a picker job of about 5 to 10 seconds.
- A workflow gains a job and a `needs` edge for each platform it routes.

### Risks

- **The service is unreachable.** The picker answers self-hosted with "no answer from the capacity service", and the job waits for the pool. The TatuiCloud watchdog opens an incident when picker jobs fall back.
- **Exemptions spread.** An exempt job takes runners without asking. Each exemption carries its reason on the line before `runs-on`.
- **Fallbacks bypass the service.** A job whose picker was skipped (a fork's pull request) or gave no answer runs on its fallback. A self-hosted fallback then takes the first free runner, which can be one the service is holding for another job. A hosted fallback avoids that, at the cost of included minutes.

## Compliance and Enforcement

The companion rules read every workflow and every composite action (`action.yml` anywhere in the repository) as YAML, so comments never count:

- `picker-pin`: any `runner-picker` action, with or without a subpath, is `barretotech/runner-picker@<40-hex SHA>`.
- `picker-service`: each picker step's `with:` sets `source: service`, `capacity-url: ${{ vars.RUNNER_CAPACITY_URL }}` and `tailnet-client-id: ${{ vars.TAILNET_CLIENT_ID_PICKER }}`.
- `routed-runs-on`: a job whose `runs-on`, or a matrix value it reads, names a self-hosted, `tatuicloud*` or `blacksmith-*` label or a `vars.*RUNNER*` variable takes its runner from a picker job: the `runs-on` starts with `needs.<job>.outputs.runs-on`, the job lists `<job>` in `needs`, and `<job>` runs the picker. The exemption marker on the line before `runs-on` waives it.
- `public-hosted-only`: in a repository whose `.archgate/repository.json` says `"visibility": "public"`, no step uses a runner picker and no job targets a self-hosted or Blacksmith runner, exempt or not. The enterprise-adrs Sync workflow writes that file from GitHub's record of the repository.

GitHub enforces the same boundary: the enterprise runner group `tatuicloud` does not serve public repositories, and the picker's organization variables are visible to private and internal repositories only.

## References

- [`barretotech/runner-picker`](https://github.com/barretotech/runner-picker)
- TatuiCloud runbook, "Runner overflow" (`BarretoTech/tatuicloud` `docs/runbook.md`)
