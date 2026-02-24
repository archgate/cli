# Archgate Cursor Integration Plan

## Context

Archgate's AI integration was built as a Claude Code plugin. With Cursor 2.5 (February 2026) shipping a full plugin system and marketplace, Cursor now supports the same primitives needed for deep agent governance — MCP servers, rules, skills, subagents, hooks, and slash commands.

The MCP server (`archgate mcp`) already works with any MCP-compatible client, including Cursor. This plan covers the additional integration work needed to give Cursor users the same governed-agent experience that Claude Code users get today.

---

## Current State

### What already works in Cursor (zero changes needed)

| Component      | How it works                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP server     | `archgate mcp` exposes `check`, `list_adrs`, `review_context`, `claude_code_session_context` tools via stdio — any MCP client can call them |
| ADR resources  | `adr://{id}` resource template works with any MCP client                                                                                    |
| Check engine   | `archgate check` is editor-agnostic                                                                                                         |
| CI integration | `archgate check --staged` / `--ci` is editor-agnostic                                                                                       |

### What requires Cursor-specific work

| Component        | Claude Code equivalent        | Cursor equivalent                            | Status  |
| ---------------- | ----------------------------- | -------------------------------------------- | ------- |
| Editor settings  | `.claude/settings.local.json` | `.cursor/mcp.json` + `.cursor/rules/*.mdc`   | Planned |
| Agent prompt     | `agents/developer.md`         | `.cursor/agents/*.md` (subagent)             | Planned |
| Skills           | `skills/*/SKILL.md`           | `.cursor/skills/*/SKILL.md` (same spec)      | Planned |
| Slash commands   | N/A (skills serve this role)  | `.cursor/commands/*.md`                      | Planned |
| Init scaffolding | `archgate init` → `.claude/`  | `archgate init --editor cursor` → `.cursor/` | Planned |
| Hooks            | N/A                           | `.cursor/hooks.json`                         | Future  |
| Marketplace      | Git-based distribution        | Cursor Marketplace plugin                    | Future  |

---

## Architecture

### Primitive Mapping

Cursor and Claude Code share the MCP protocol and the Agent Skills specification (agentskills.io). The differences are in how settings, rules, and agent prompts are configured.

```
                        ┌─────────────────────────────────┐
                        │         archgate CLI             │
                        │   (editor-agnostic core)         │
                        ├─────────────────────────────────┤
                        │  .archgate/adrs/   ← ADRs       │
                        │  .archgate/lint/   ← linter rules│
                        │  src/engine/       ← check engine│
                        │  src/mcp/          ← MCP server  │
                        └──────────┬──────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
              ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
              │ Claude Code│ │  Cursor   │ │  Future   │
              │  Plugin    │ │  Plugin   │ │  Editors  │
              ├───────────┤ ├───────────┤ ├───────────┤
              │ .claude/   │ │ .cursor/  │ │ .editor/  │
              │ settings   │ │ mcp.json  │ │ config    │
              │ agents/    │ │ agents/   │ │           │
              │ skills/    │ │ skills/   │ │           │
              └───────────┘ └───────────┘ └───────────┘
```

### Editor Abstraction in `archgate init`

The `init` command gains an `--editor` flag to scaffold editor-specific settings:

```
archgate init                    # default: configures Claude Code
archgate init --editor claude    # explicit: configures Claude Code
archgate init --editor cursor    # configures Cursor
```

Both paths create the same `.archgate/` governance structure. The only difference is which editor settings are generated.

---

## Implementation

### Phase 1: `archgate init --editor cursor` (this PR)

#### 1.1 New helper: `src/helpers/cursor-settings.ts`

Creates Cursor-specific configuration files when `archgate init --editor cursor` is run.

**Files created:**

1. **`.cursor/mcp.json`** — Registers the archgate MCP server:

```json
{
  "mcpServers": {
    "archgate": {
      "command": "archgate",
      "args": ["mcp"]
    }
  }
}
```

2. **`.cursor/rules/archgate-governance.mdc`** — Always-on governance rule:

```markdown
---
description: Archgate ADR governance — enforces architecture decision records
globs:
alwaysApply: true
---

# Archgate Governance

This project uses Archgate to enforce Architecture Decision Records (ADRs).

## Before writing code

- Use the `review_context` MCP tool to get applicable ADR briefings for changed files
- Review the Decision and Do's/Don'ts sections of each applicable ADR

## After writing code

- Run the `check` MCP tool to validate compliance with all ADR rules
- Fix any violations before considering work complete

## ADR commands

- `list_adrs` — List all active ADRs with metadata
- `check` — Run automated compliance checks (use `staged: true` for pre-commit)
- `review_context` — Get changed files grouped by domain with ADR briefings

## Key principle

Architectural decisions are enforced, not suggested. If `check` reports violations, they must be fixed.
```

#### 1.2 Updated `src/helpers/init-project.ts`

Adds an `editor` option to `initProject()`:

```typescript
export interface InitOptions {
  editor?: "claude" | "cursor";
}
```

- `editor: "claude"` (default) — calls `configureClaudeSettings()`
- `editor: "cursor"` — calls `configureCursorSettings()`

#### 1.3 Updated `src/commands/init.ts`

Adds `--editor <editor>` option:

```typescript
.option("--editor <editor>", "editor integration to configure", "claude")
```

#### 1.4 Tests

- `tests/helpers/cursor-settings.test.ts` — unit tests for `configureCursorSettings()` and `mergeCursorMcpConfig()`
- Update `tests/helpers/init-project.test.ts` — test `editor: "cursor"` option

### Phase 2: Skills and Subagents (future)

The Claude Code plugin skills (`architect`, `quality-manager`, `adr-author`) follow the open Agent Skills specification (agentskills.io). These should work in Cursor with minimal changes.

| Skill             | Source                                   | Cursor path                               |
| ----------------- | ---------------------------------------- | ----------------------------------------- |
| `architect`       | `plugin/skills/architect/SKILL.md`       | `.cursor/skills/architect/SKILL.md`       |
| `quality-manager` | `plugin/skills/quality-manager/SKILL.md` | `.cursor/skills/quality-manager/SKILL.md` |
| `adr-author`      | `plugin/skills/adr-author/SKILL.md`      | `.cursor/skills/adr-author/SKILL.md`      |

The developer agent (`plugin/agents/developer.md`) would become a Cursor subagent at `.cursor/agents/archgate-developer.md`.

### Phase 3: Hooks (future)

Cursor hooks enable automatic governance enforcement:

```json
{
  "hooks": {
    "afterFileEdit": {
      "command": "archgate check --staged --json",
      "description": "Run ADR compliance check after file edits"
    }
  }
}
```

### Phase 4: Cursor Marketplace (future)

Package as a Cursor plugin (`.cursor-plugin/`) with:

```
archgate-cursor-plugin/
├── plugin.json                           # Marketplace metadata
├── marketplace.json                      # Listing info
├── mcp.json                              # archgate MCP server
├── hooks.json                            # afterFileEdit auto-check
├── rules/
│   └── archgate-governance.mdc           # alwaysApply: true
├── agents/
│   └── archgate-developer.md             # Governance subagent
├── commands/
│   ├── archgate-check.md                 # /archgate-check
│   └── archgate-review.md                # /archgate-review
└── skills/
    ├── architect/SKILL.md
    ├── quality-manager/SKILL.md
    └── adr-author/SKILL.md
```

Installable via `/add-plugin` in Cursor.

---

## MCP Tool Compatibility

The `session_context` tool has been renamed to `claude_code_session_context` to signal that it reads Claude Code session transcripts (from `~/.claude/projects/`). This tool is Claude Code-specific and will not function in Cursor.

The remaining three tools are fully editor-agnostic:

| Tool                          | Editor-agnostic? | Notes                                   |
| ----------------------------- | :--------------: | --------------------------------------- |
| `check`                       |       Yes        | Runs ADR compliance checks              |
| `list_adrs`                   |       Yes        | Lists ADRs with metadata                |
| `review_context`              |       Yes        | Changed files + ADR briefings           |
| `claude_code_session_context` |        No        | Reads `~/.claude/projects/` JSONL files |

A future `cursor_session_context` tool could be added if Cursor exposes session transcript data.

---

## Open Questions

1. **Skills portability** — The Agent Skills spec (agentskills.io) is shared across Claude Code, Cursor, Copilot. How much adaptation is needed for the skill prompts to work well with Cursor's agent? Likely minimal, but needs testing.
2. **Hook granularity** — Cursor's `afterFileEdit` hook fires on every edit. Running `archgate check` after every edit may be noisy. Should we batch or debounce?
3. **Marketplace publishing** — Cursor Marketplace requires review. Timeline and requirements TBD.
4. **Subagent model selection** — Cursor subagents can specify which model to use. Should the archgate subagent enforce a specific model, or defer to the user's default?
