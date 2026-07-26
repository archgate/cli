---
name: project-claude-code-hooks-config
description: Claude Code hook behaviour in .claude/settings.json that nothing in this repo can check
metadata:
  type: project
---

- **Command hooks using POSIX syntax need `"shell": "bash"` explicitly**, even on Windows with Git Bash installed — hooks have their own shell detection and silently fall back to `cmd.exe` (symptom: `'x' is not recognized as an internal or external command`). If Git Bash still isn't found, set `CLAUDE_CODE_GIT_BASH_PATH`.
- **Don't simplify `WorktreeCreate` back to a bare `bun install`** — the stale-dir `rm -rf`, the `git worktree prune`, the `tr -d '\r'` on `name`, and warn-don't-exit on `bun install` failure each fixed a real breakage (#441, #442).
- **Claude Code cloud environments (claude.ai/code) can't install deps via the environment's own setup script** — the cloud image ships Bun preinstalled, so `curl -fsSL https://bun.sh/install` 403s (bun.sh isn't on the Trusted network allowlist, which only covers package registries/GitHub) and is unnecessary anyway. Worse, `bun install` itself has documented proxy-compatibility issues when run from the setup-script phase (all cloud egress routes through a security proxy Bun doesn't handle cleanly). Anthropic's own fix is a repo-level `SessionStart` hook instead — see `scripts/install-cloud-deps.sh` (guarded on `CLAUDE_CODE_REMOTE == "true"`) wired into `.claude/settings.json`'s `hooks.SessionStart`. This is the documented workaround, not a guaranteed fix — if `bun install` still fails inside the hook, that's a known unresolved limitation per https://code.claude.com/docs/en/claude-code-on-the-web, not a misconfiguration.
