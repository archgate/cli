---
name: project-release-pipeline-gotchas
description: Three causes behind archgate/cli release publishing failures found 2026-07-03
metadata:
  type: project
---

Four distinct issues caused shim/binary publishing failures across v0.45.1–v0.46.1, fixed in `fix/publish-shims-race`:

1. **Workflow race**: `publish-shims.yml` and `release-binaries.yml` both triggered on `release: published`. If binaries needed a retry, `publish-shims.yml`'s fixed-budget `wait-for-binaries` poll timed out and went `cancelled` (terminal) before the retry finished. Fixed: `publish-shims.yml` is now `workflow_dispatch`-only; `release-binaries.yml`'s `trigger-shim-publish` job dispatches it via `gh workflow run` after binaries + provenance succeed.
2. **`moonrepo/setup-toolchain` cache bug**: right after a `.prototools` bump, the first macOS/Windows CI run can restore a stale `restore-key` cache fallback instead of an exact hit — the action reports success but `bun` isn't on PATH. Log signature: `Cache hit for restore-key:` (vs. exact `Cache hit for:`). Self-heals on retry (the failing job still saves a fresh exact-key cache in post-job cleanup). No code fix — just don't chase it as flakiness.
3. **Update-check stdout pollution**: `src/cli.ts` printed a background "update available" notice to stdout after every command, unconditionally. Broke `JSON.parse(stdout)` in CLI-subprocess tests (and would break real `| jq` usage) whenever a newer release existed. Fixed via `shouldPerformUpdateCheck()` in `src/helpers/update-check.ts` — only checks in a genuine TTY, non-CI, non-`upgrade` session.
4. **`publish-go-tag` missing `workflows: write`**: its `git push origin shims/go/$TAG` was rejected — GitHub blocks any ref push reachable through commits touching `.github/workflows/*` without that permission, even for an unrelated tag. Fixed by adding `workflows: write` to the job's `permissions:`. Confirmed on v0.45.7's job log.

**Why:** Diagnosed while investigating why v0.46.0/v0.46.1 kept failing to publish despite repeated manual retries.
**How to apply:** If a release build fails and a retry "just works," check which of these four it was before assuming generic flakiness.
