---
name: project-worktree-create-hook-contract
description: WorktreeCreate hook contract (stdin JSON in, path-only stdout out) and the 5 rounds of bugs found fixing it
metadata:
  type: project
---

Once `hooks.WorktreeCreate` is configured in `.claude/settings.json`, the harness defers the **entire** worktree creation to it — no parallel automatic git worktree creation happens. Contract: hook receives `{"cwd","name","session_id",...}` on **stdin**, and must print ONLY the final absolute worktree path as its last stdout line — any other stdout (unsilenced `bun install`/`git worktree add` banners) gets misread as the path and corrupts session state. Redirect all setup output to `>&2`.

See [CLAUDE.md](../../../CLAUDE.md) "Claude Code Harness Config" for the current, correct hook implementation. Do not simplify it back to a bare `bun install` — that regression is exactly what broke it originally (21 stale empty worktree dirs found from the old broken version).

**Bugs found fixing it (all true positives, all confirmed by reproduction before fixing — reproduce Bugbot/reviewer findings against the real script, don't just reason about the code):**

1. Stale non-worktree leftover dir at the target path silently skipped `git worktree add`. Fix: check for `"$dir/.git"`, `rm -rf` first if it's a stale non-worktree dir.
2. `jq -r` can emit CRLF on Windows Git Bash; the trailing `\r` alone reproduces "path contains control characters." Fix: `tr -d '\r'` on `name`. (`cat -A` or byte-length comparison reliably detects an embedded `\r`; `grep -q '\r'` against `od -c` output gives false positives.)
3. `bun install --silent` failures were silently swallowed (no exit check). Deliberately NOT hard-failed — by then the worktree may be a reused one with real uncommitted work, so hard-fail-without-cleanup risks orphaning dirs again, and cleanup risks deleting real work on a transient failure. Fix: explicit `warning: bun install failed...` to stderr instead.
4. A worktree whose directory was deleted without `git worktree remove` leaves git's internal registration (`prunable`) behind, so `git worktree add` at the same path/branch later fails with `fatal: '<branch>' is already used by worktree`. Fix: `git worktree prune >&2` immediately before `git worktree add`.
5. (2026-07-01, different machine, user-reported) Hook fell back to cmd.exe despite Git Bash being on PATH and the interactive `Bash` tool correctly using it — hooks have a separate, independently-implemented shell-detection path from the interactive tool. Fix: set `"shell": "bash"` explicitly on the hook object; don't rely on autodetection when mixing POSIX syntax with Windows. Without it, Claude Code resolves Git Bash via `CLAUDE_CODE_GIT_BASH_PATH` → `C:\Program Files\Git\bin\bash.exe` (or x86) → `git` on PATH resolved to `../../bin/bash.exe`, in that order.

**Lesson:** `git worktree remove` never deletes the branch — `claude/<name>` branches accumulate locally; periodic `git branch -D` cleanup of merged/abandoned ones is a manual chore. If touching this hook again, regression-test all 5 repros above, not just the happy path — small script, but more git-worktree-state failure modes than are obvious up front.
