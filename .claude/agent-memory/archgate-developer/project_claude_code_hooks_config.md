---
name: project-claude-code-hooks-config
description: Claude Code hook behaviour in .claude/settings.json that nothing in this repo can check
metadata:
  type: project
---

- **Command hooks using POSIX syntax need `"shell": "bash"` explicitly**, even on Windows with Git Bash installed — hooks have their own shell detection and silently fall back to `cmd.exe` (symptom: `'x' is not recognized as an internal or external command`). If Git Bash still isn't found, set `CLAUDE_CODE_GIT_BASH_PATH`.
- **Don't simplify `WorktreeCreate` back to a bare `bun install`** — the stale-dir `rm -rf`, the `git worktree prune`, the `tr -d '\r'` on `name`, and warn-don't-exit on `bun install` failure each fixed a real breakage (#441, #442).
