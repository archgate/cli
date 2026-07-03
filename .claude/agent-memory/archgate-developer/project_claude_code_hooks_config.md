---
name: project-claude-code-hooks-config
description: How this repo's .claude/settings.json hooks work — WorktreeCreate contract and the shell:bash requirement for POSIX hooks
metadata:
  type: project
---

`hooks.WorktreeCreate` is **not** a post-creation setup step — once configured, the harness defers the _entire_ worktree creation to it. The hook gets `{ "cwd", "name", ... }` on stdin and **must** create the worktree itself, printing _only_ the final absolute path as its last stdout line — any other stdout (unsilenced `bun install`/`git worktree add` output) gets misread as the path, breaking `EnterWorktree`/`ExitWorktree` (`path contains control characters`, `ENOENT: ... chdir`). Redirect all setup output to `>&2`. Don't simplify this back to a bare `bun install` — see [[project_worktree_create_hook_contract]] for the full bug history (5 rounds of fixes, all worth re-testing if this hook changes).

**Command-type hooks with POSIX syntax MUST set `"shell": "bash"` explicitly**, even on Windows with Git Bash installed — hooks have a separate shell-detection path from the interactive `Bash` tool and can silently fall back to `cmd.exe` without it (symptom: `'x' is not recognized as an internal or external command...`). If Git Bash still isn't found, Claude Code checks `CLAUDE_CODE_GIT_BASH_PATH` → `C:\Program Files\Git\bin\bash.exe` (or x86) → `git` on PATH resolved to `../../bin/bash.exe`.

**How to apply:** read this before touching any hook in `.claude/settings.json`, not just WorktreeCreate — the `"shell": "bash"` requirement applies to every command-type hook using POSIX syntax.
