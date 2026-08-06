---
name: ci-run-behavior
description: Why expected CI jobs go missing (conflicting PR) or die mid-run (PR body edit), and the misleading coverage failure that follows
metadata:
  type: project
---

Two ways the Validate workflow fails to tell you what you think it is telling you. Both present as a problem with the change rather than with the run.

## A conflicting PR runs no workflows at all

`pull_request` events build against the merge ref, which GitHub cannot create while the PR is `CONFLICTING`. The checks then appear simply **absent** rather than failing.

**How to apply:** when expected jobs never show up, read `gh pr view <n> --json mergeable` before hunting for a workflow misconfiguration.

## Editing a PR's title or body cancels its in-flight run

`code-pull-request.yml` triggers on `pull_request: [edited]`, and its concurrency group sets `cancel-in-progress`, so a `gh pr edit` mid-run supersedes the run already going.

The downstream symptom is misleading rather than obvious: the cancelled Windows smoke test never uploads `coverage-windows`, so the Coverage job merges Linux alone and reports a figure a fraction under the 99.5% gate — which reads as a coverage regression caused by your change.

**How to apply:** check `gh run list --workflow Validate` for a superseding run before investigating coverage at all. Edit the body before pushing, or once the run has finished.

See also [[coverage-measurement]] for why a single-platform number sits below the merged one.
