---
name: project-session-context-skip-root-fix
description: opencode session-context --skip 1 sibling/inline-skill bug fixed via new --root flag (2026-07-01); same class of bug likely still open for claude-code/cursor/copilot
metadata:
  type: project
---

Fixed a real, reproduced bug in `archgate session-context opencode --skip 1`: it could return a completely unrelated sibling sub-agent's session transcript instead of the true parent/development session. Fix shipped 2026-07-01 as a new `--root` flag on `archgate session-context opencode` (see `src/helpers/session-context-opencode.ts` and `src/commands/session-context/opencode.ts`).

**Why:** `readOpencodeSession`'s `--skip N` selected the Nth-most-recently-updated session sharing a project directory, ignoring opencode's real `session.parent_id` column entirely. This breaks in two ways: (1) the opencode `Skill` tool runs inline in the current session (no new session row), so "skip past my own session" skips past the actual parent instead; (2) sibling sub-agent sessions fanned out from the same parent (e.g. the `archgate:reviewer` skill's parallel domain-review agents) interleave in recency order with the parent, so `--skip 1` can land on any sibling. Verified this concretely against the user's real `~/.local/share/opencode/opencode.db`: a live `archgate-lessons-learned` skill invocation's `--skip 1` call returned the "General process ADR review" sub-agent's private transcript instead of the parent session.

`--root` fixes this by filtering to `parent_id IS NULL` before applying `skip`, which is correct regardless of nesting depth or sibling count. The `archgate-lessons-learned` skill's opencode variant was updated to use `--root` instead of `--skip 1` — see [[project_plugins_generated_skill_files]] for where that source actually lives.

**Open/unresolved:** The _same class_ of bug likely still affects the other 3 editors' lessons-learned skill guidance (`archgate session-context claude-code --skip 1`, `cursor --skip 1`). Live-reproduced for Claude Code in this same session: running `archgate session-context claude-code --skip 1` from within an inline Skill invocation (this very lessons-learned run) returned an unrelated, unconnected past session (`6ee6f0a5-...` about "ExitWorktree"), not the current/parent conversation — because Claude Code's Skill tool also runs inline, so `--skip 1` skips past the correct (current) session file. Unlike opencode, Claude Code/Cursor have no `parent_id`-equivalent — sessions are flat per-conversation JSONL/directory files with no structural parent link, so the `--root` fix pattern doesn't directly transfer; a different fix (e.g. detecting "am I inline vs a real sub-agent" some other way, or defaulting to `--skip 0` for inline skill runs) would be needed. Not investigated for Copilot. This has NOT been fixed — flag to the user before doing more lessons-learned/reviewer work that depends on `--skip 1` being reliable for non-opencode editors.

**How to apply:** If asked to investigate "session context returns wrong data" for claude-code, cursor, or copilot, start here — this is the same architectural flaw already fixed once for opencode, not a new mystery.
