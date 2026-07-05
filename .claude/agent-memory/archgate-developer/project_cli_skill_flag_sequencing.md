---
name: project-cli-skill-flag-sequencing
description: General rule for sequencing releases when a shipped editor skill references a CLI flag that's being added or removed
metadata:
  type: project
---

Distributed editor skills (e.g. the opencode lessons-learned skill) reference specific `archgate` CLI flags in their instructions. When changing session-context (or any) CLI flag surface, sequence releases deliberately:

- **Flag ADDITIONS**: ship the CLI release first. A skill referencing a flag the installed CLI lacks dies with "unknown option."
- **Flag REMOVALS** (e.g. `--skip`, removed 2026-07-02): already-installed skills still reference the dead flag and error on the new CLI. Ship the plugin release promptly after the CLI release, and keep an error-fallback path in the skill text for the gap in between.
- Don't hand-edit the installed copy under `~/.config/opencode/skills/` (or other editors' skill dirs) before the CLI release — edit the canonical source and let the plugin release distribute it.

**How to apply:** treat "update a CLI flag referenced by a shipped skill" as a two-release coordination problem, not a single-PR change.

**Confirmed still outstanding (2026-07-04):** the installed Claude Code `archgate:lessons-learned` skill, plugin version 0.13.1, still instructs `archgate session-context claude-code --skip 1` and still asserts the false "runs as a sub-agent with its own session file" premise — the exact issue [[project_session_context_skip_root_fix]] documents as resolved for the CLI/canonical skill source. The command fails outright (`error: unknown option '--skip'`) since the flag was removed 2026-07-02. This means the plugin release carrying the fix has not reached this installed version (or a newer plugin version exists but wasn't installed here — check `~/.claude/plugins/cache/archgate/archgate/` for available versions vs. the one actually active). If this recurs, don't just work around it locally — it means the two-release sequencing above didn't fully land for the claude-code skill variant specifically.
