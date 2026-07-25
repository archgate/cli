---
name: project-stale-context-vs-disk
description: The session's CLAUDE.md snapshot and the working tree can both be stale — verify against disk and against origin/main before acting
metadata:
  type: project
---

- **The `CLAUDE.md` shown in the system prompt is a snapshot from session start and does not update when the branch changes.** After resetting onto `origin/main` mid-session, the snapshot still described the npm shim as `bin/archgate.cjs` while the file on disk (refreshed by a later PR) correctly said `shims/npm/archgate.cjs`. Acting on the snapshot would have "fixed" a bug that no longer existed. Re-read `CLAUDE.md` from disk before correcting anything it appears to get wrong.
- **A branch can be fully merged while `git log` still shows it as ahead.** Squash-merges rewrite the SHAs, so `git rev-list origin/main..HEAD` reported six unmerged commits that were all already in `main` under different hashes. Confirm by subject (`git log origin/main --grep "<subject>" --fixed-strings`) or by grepping `main` for a distinctive identifier the work introduced — not by commit count.
- **Uncommitted changes in a stale tree are usually duplicates, but check each file separately.** In the same tree, `src/engine/runner.ts` was byte-for-byte work already merged, while two memory files carried notes that existed nowhere else. Salvage per file before any `reset --hard`.
- **Verify a memory note against current code before folding it back in.** A salvaged note claiming `ctx.ast()` caches only TS/JS was stale — the per-run cache had since been widened to every language, which makes the underlying trap broader, not narrower. The corrected note is in [[project_rules_engine_internals]].
