---
name: project-ci-workflow-gotchas
description: GitHub Actions gotchas outside the release pipeline (token permissions, config namespaces, shell encoding)
metadata:
  type: project
---

- **`GITHUB_TOKEN`-authored pushes do NOT trigger downstream workflows.** A workflow pushing commits/PRs with `github.token`/`secrets.GITHUB_TOKEN` suppresses the resulting `push`/`pull_request` events (anti-recursion), so required PR checks never run. Fix: author such pushes with a GitHub App installation token (`actions/create-github-app-token`) on both `actions/checkout` and the pushing step.
- **`secrets.*` and `vars.*` are separate, non-overlapping namespaces** — configuring a value as one does not make it readable via the other. Confirm the actual location with `gh secret list`/`gh variable list` before writing a reference. Full incident writeup (PostHog annotation step silently no-opping for weeks) is in `CLAUDE.md`'s "GitHub Actions: `secrets.*` vs `vars.*`" section.
- **jq on Windows Git Bash emits CRLF line endings.** `jq -r` output carries a trailing `\r` after command-substitution newline-stripping (and mid-list entries too). Pipe through `tr -d '\r'`. Broke `install.sh`'s `resolve_version` release-walk (skipped every tag but the last).
