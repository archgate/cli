---
name: project-session-context-skip-root-fix
description: session-context --skip was removed entirely (2026-07-02) after two rounds of bugs — replaced with per-editor list/show subcommands
metadata:
  type: project
---

**Current shape (final, 2026-07-02):** `--skip` was removed from all four editor subcommands. Explicit selection instead: `archgate session-context <editor> list` / `show <session-id>`. `--root` exists only on `opencode show` (resolves a child session to its top-level ancestor via `parent_id`; opencode `list` is top-level-only). Bare editor subcommands take only `--max-entries` and always read the current conversation.

**Why it got here:** `--skip N` originally picked the Nth-most-recently-updated session sharing a project directory, ignoring opencode's real `parent_id` column. Two independent bugs: (1) opencode's `Skill` tool runs inline (no new session row), so "skip past my own session" skipped the actual parent instead, and sibling sub-agent sessions (e.g. `archgate:reviewer`'s parallel domain agents) could interleave ahead of it in recency order — reproduced against a real `opencode.db` (a lessons-learned skill run returned an unrelated sub-agent's transcript). Fixed 2026-07-01 via top-level (`parent_id IS NULL`) filtering by default + `--root`. (2) The SAME `--skip 1` guidance was then found wrong for claude-code/cursor/copilot too, but for a different reason: skills run inline there as well, and Agent-tool sub-agents don't write their own session files at all — so the plain command (skip 0) was always correct for those editors; no `parent_id`-style fix was needed. Since the flag's only purpose was this false premise, it was removed everywhere rather than fixed per-editor.

**Remaining caveat (all editors):** with several concurrent conversations for the same project, most-recent-by-mtime can pick the wrong live conversation. `opencode show --session-id <id> --root` is deterministic; claude-code/cursor have no equivalent linkage.

**Inspecting real opencode data:** the live `opencode.db` can't be opened `readonly: true` while opencode runs (`SQLITE_CANTOPEN`). Copy `opencode.db` + `.db-wal` + `.db-shm` to a temp dir first.

**How to apply:** if "session context returns wrong data" comes up again for claude-code, cursor, or copilot, start here — same class of flaw, already resolved once. See also [[project_cli_skill_flag_sequencing]] for the release-sequencing rule this fix's `--skip` removal triggered.
