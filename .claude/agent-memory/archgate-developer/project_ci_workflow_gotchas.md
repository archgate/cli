---
name: project-ci-workflow-gotchas
description: GitHub Actions gotchas outside the release pipeline (token permissions, config namespaces, shell encoding)
metadata:
  type: project
---

- **`GITHUB_TOKEN`-authored pushes do NOT trigger downstream workflows.** A workflow pushing commits/PRs with `github.token`/`secrets.GITHUB_TOKEN` suppresses the resulting `push`/`pull_request` events (anti-recursion), so required PR checks never run. Fix: author such pushes with a GitHub App installation token (`actions/create-github-app-token`) on both `actions/checkout` and the pushing step.
- **`secrets.*` and `vars.*` are separate, non-overlapping namespaces** — configuring a value as one does not make it readable via the other. `release.yml`'s PostHog annotation step once read `vars.POSTHOG_PROJECT_ID` when the value only existed as a **secret**, silently no-opping for weeks behind `continue-on-error: true` + a low-visibility `::notice::`. Confirm the actual location with `gh secret list`/`gh variable list` before writing a reference. For any `continue-on-error` step with a skip-on-missing-config guard, use `::warning::` (not `::notice::`) so misconfiguration is visible in the Actions UI.
- **jq on Windows Git Bash emits CRLF line endings.** `jq -r` output carries a trailing `\r` after command-substitution newline-stripping (and mid-list entries too). Pipe through `tr -d '\r'`. Broke `install.sh`'s `resolve_version` release-walk (skipped every tag but the last).
