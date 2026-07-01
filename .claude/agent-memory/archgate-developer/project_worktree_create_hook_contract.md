---
name: project-worktree-create-hook-contract
description: How the Claude Code WorktreeCreate hook contract works — stdin JSON in, path-only stdout out — and how the repo's hook was broken/fixed
metadata:
  type: project
---

`.claude/settings.json`'s `hooks.WorktreeCreate` hook was broken from ~Feb 2026 (or earlier) until fixed on 2026-07-01: it only ran `bun install`, which is not enough — once a `WorktreeCreate` hook is configured, the harness defers the **entire** worktree creation to it (no automatic git worktree creation happens in parallel). Symptom reported by the user: `WorktreeCreate hook failed: path contains control characters`; empirically also produced `ENOENT: ... chdir 'E:\archgate\cli\' -> '<bun install stdout>'`.

**Why:** Diagnosed by dumping the hook's stdin/env/args to a side-channel file (`{ echo ...; cat; env; } > /tmp/debug.txt; pwd`) and by calling `EnterWorktree` directly to observe raw harness errors. Found: (1) the hook receives a JSON payload on **stdin** — `{"cwd", "name", "session_id", ...}` — same pattern as the existing `PostToolUse` hook that reads `.tool_input.file_path` via `jq`; (2) the harness error `hook succeeded but returned no worktree path (command: echo the path to stdout; ...)` reveals the hook **must** print only the resulting absolute worktree path as its final stdout line; (3) any other stdout (unsilenced `bun install`, `git worktree add` banner text) gets misread by the harness as the path, corrupting session state (`ExitWorktree` later reported removing a worktree "at Checked 177 installs... [28ms]" — the literal bun install stdout).

**Evidence of prior breakage:** `.claude/worktrees/` had 21 stale, completely empty leftover directories (no `.git` file, no content) alongside orphaned local branches like `claude/wonderful-bose-0f7e45` — confirming `git worktree add` used to run (via some earlier, more complete hook version) but the directory was left behind when path corruption broke cleanup.

**How to apply:** The fixed hook (see `CLAUDE.md` "Claude Code Harness Config" section) parses `.name` from stdin via `jq`, creates `git worktree add "$CLAUDE_PROJECT_DIR/.claude/worktrees/$name" -B "claude/$name"`, redirects ALL setup command output to stderr (`>&2`), and ends with `printf '%s\n' "$dir"` as the only real stdout. Verified end-to-end via `EnterWorktree`/`ExitWorktree` — worktree created with full file content + `node_modules`, session cwd matched, clean removal. Note: `git worktree remove` does not delete the branch — `claude/<name>` branches accumulate locally over time; periodic `git branch -D` cleanup of merged/abandoned `claude/*` branches is a reasonable manual chore, not automated by anything.

If this hook is ever "simplified" back to a bare `bun install`, the exact same bug returns.
