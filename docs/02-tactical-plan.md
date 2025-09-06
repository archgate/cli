# Archgate Tactical Plan: What to Build and When

## Current State (Feb 2026)

The CLI has evolved from a v0.1.0 scaffolding tool to a full governance engine. Phases 0 through 2.5 are complete:

- **Phase 0 (Foundation)** — ADR format spec, governance-first `init`, full `adr` command group (create/list/show/update), testing infrastructure, self-dogfood ADRs with executable rules
- **Phase 1 (Check Engine)** — Rule loader + runtime with full context API (glob, grep, readFile, report), `archgate check` command (--json, --ci, --staged, --adr), CI integration with GitHub Actions annotations, self-dogfood checks passing
- **Phase 2 (AI Integration)** — MCP server exposing tools (check, list-adrs, review-context, session-context) + resources (adr://{id})
- **Phase 2.5 (Claude Code Plugin)** — Role-based skills (architect, quality-manager, adr-author), developer agent, and rich review context for AI-assisted governance workflows

**Phase 2 PIVOTED:** The `archgate review` and `archgate capture` commands originally called the Anthropic API directly. This violated Anthropic's ToS for OAuth tokens (Free/Pro/Max plans). AI-powered features have been moved to a Claude Code plugin (`plugin/`) where Claude Code handles all AI interactions natively. The CLI remains standalone for deterministic operations (init, check, adr, mcp).

**Removed over time:** `archgate start`, `archgate frontend component` (too opinionated, premature). `archgate review`, `archgate capture`, `archgate stats`, `archgate generate-skills` (replaced by Claude Code plugin). `archgate pack add/list/remove` (simplified — packs are npm packages installed manually). `archgate plugin generate` (replaced by static plugin shipping with CLI). `archgate adr deprecate` (replaced by `adr update`). `src/agent/` module (skill/plugin generation logic moved to plugin static files). `src/formats/config.ts`, `src/formats/pack.ts` (simplified to just `adr.ts` + `rules.ts`).

---

## Phase 0: Foundation Reset ✅ COMPLETE

**Goal:** Restructure the CLI to support the governance use cases. Keep what works, discard what doesn't serve the vision.

### Tasks

- [x] **T0.1** Define the ADR file format specification
  - `src/formats/adr.ts`: frontmatter parsing, validation, full schema (id, title, domain, rules, files)
  - `src/formats/rules.ts`: rule file schema with `defineRules()`

- [x] **T0.2** Refactor `archgate init`
  - `src/commands/init.ts` + `src/helpers/init-project.ts`: creates `.archgate/` skeleton with adrs/
  - Interactive mode with `--yes` flag for automation
  - Works in existing repos (brownfield)

- [x] **T0.3** Add `archgate adr` command group
  - `src/commands/adr/create.ts` — interactive + non-interactive ADR creation
  - `src/commands/adr/list.ts` — list with `--json` and `--domain` filter
  - `src/commands/adr/show.ts` — display ADR content
  - `src/commands/adr/update.ts` — update ADR by ID (added later, completes lifecycle)

- [x] **T0.4** Set up testing infrastructure
  - 12 test files covering commands, engine, formats
  - Bun test runner, fixtures in `tests/fixtures/`

- [x] **T0.5** Dogfood: write Archgate ADRs for the CLI itself
  - 6 ADRs: ARCH-001 (command structure), ARCH-002 (error handling), ARCH-003 (output formatting), ARCH-004 (no barrel files), ARCH-005 (testing), ARCH-006 (dependencies)
  - All have companion `.rules.ts` files with real, executable checks

---

## Phase 1: The Check Engine ✅ COMPLETE

**Goal:** `archgate check` — fast, free, deterministic ADR compliance validation.

### Tasks

- [x] **T1.1** Implement rule file loader
  - `src/engine/loader.ts`: discovers ADRs with `rules: true`, imports `.rules.ts` dynamically, supports pack-based rules

- [x] **T1.2** Implement rule runtime
  - `src/engine/runner.ts`: full `RuleContext` API — `glob()`, `grep()`, `grepFiles()`, `readFile()`, `readJSON()`, `report.violation/warning/info()`
  - Respects `.gitignore` via `git ls-files`, 30s timeout per rule, parallel ADR execution

- [x] **T1.3** Implement `archgate check` command
  - `src/commands/check.ts`: flags `--json`, `--ci`, `--staged`, `--adr <id>`, `--verbose`
  - Three report formats: console (colored), JSON, GitHub Actions annotations
  - Exit codes: 0=pass, 1=violations, 2=rule errors

- [x] **T1.4** ~~Implement ADR pack system~~ **SIMPLIFIED**
  - Pack CLI commands (`pack add/list/remove`) removed — packs are npm packages installed manually
  - Engine still loads rules from `.archgate/packs/*/adrs/`

- [ ] **T1.5** Create starter ADR packs
  - **Not yet published.** Pack infrastructure is ready but no standalone packs exist yet.
  - **`@archgate/pack-typescript`**, **`@archgate/pack-testing`**, **`@archgate/pack-api-design`** remain planned.
  - Moved to Phase 3 (ecosystem).

- [x] **T1.6** CI integration
  - `src/engine/reporter.ts`: `reportCI()` outputs GitHub Actions `::error` annotations
  - `archgate check --staged` for pre-commit support

- [x] **T1.7** Dogfood: run `archgate check` on the CLI itself
  - 6 ADRs with real `.rules.ts` rules, all passing against CLI codebase

---

## Phase 2: AI Agent Integration ✅ COMPLETE (PIVOTED)

**Goal:** MCP server for AI tool integration. AI-powered review/capture delivered as Claude Code plugin.

### Tasks

- [x] **T2.1** Implement `archgate mcp` command
  - `src/mcp/server.ts` + `src/mcp/tools/` + `src/mcp/resources.ts`
  - Tools: `check`, `list_adrs`, `review_context`, `session_context`
  - Resources: `adr://{id}` for full ADR markdown
  - Stdio transport via `startStdioServer()`
  - `src/engine/context.ts` provides shared review context logic (section extraction, file-to-ADR matching)

- [x] **T2.2** ~~Implement `archgate review` command~~ **PIVOTED to Claude Code plugin**
  - Was: `src/commands/review.ts` + `src/agent/review.ts` (Anthropic SDK agentic loop)
  - Now: `plugin/skills/architect/SKILL.md` (architecture review skill invoked by developer agent)

- [x] **T2.3** ~~Implement `archgate capture` command~~ **PIVOTED to Claude Code plugin**
  - Was: `src/commands/capture.ts` + `src/agent/capture.ts` (Anthropic SDK agentic loop)
  - Now: `plugin/skills/quality-manager/SKILL.md` (learning capture skill invoked by developer agent)

- [x] **T2.4** ~~Claude Code skill generation~~ **REMOVED**
  - Was: `src/agent/skills.ts` converting ADRs to SKILL.md files
  - Replaced by static plugin skills + `review_context` MCP tool that provides condensed ADR briefings on demand

- [x] **T2.5** ~~Token cost reporting~~ **REMOVED** — Claude Code manages tokens natively

---

## Phase 2.5: Claude Code Plugin ✅ COMPLETE

**Goal:** Deliver AI-powered governance features as a Claude Code plugin. Bridge the gap between "tools exist" and "tools are used correctly during development."

### Tasks

- [x] **T2.5.1** Plugin directory structure and static plugin
  - `plugin/` directory ships with npm package
  - `plugin/settings.json` — default agent configuration
  - MCP server configuration connecting to `archgate mcp`

- [x] **T2.5.2** Role-based skills
  - `plugin/skills/architect/SKILL.md` — architecture review role (validates code against ADRs)
  - `plugin/skills/quality-manager/SKILL.md` — learning capture role (proposes new ADRs/updates)
  - `plugin/skills/adr-author/SKILL.md` — ADR authoring role (creates/edits ADRs following conventions)

- [x] **T2.5.3** Developer agent
  - `plugin/agents/developer.md` — orchestrates the full governance workflow
  - Reads ADRs before coding, validates with `@architect`, captures with `@quality-manager`
  - Enforces the UNDERSTAND → PLAN → WRITE → VALIDATE → CAPTURE workflow

- [x] **T2.5.4** Rich review context via MCP
  - `review_context` MCP tool — pre-computes domain-grouped ADR briefings (Decision + Do's/Don'ts only)
  - `session_context` MCP tool — extracts Claude Code session transcripts for context recovery
  - `src/engine/context.ts` — shared context building logic (section extraction, file-to-ADR matching)

- [x] **T2.5.5** Shared helper modules
  - `src/helpers/adr-writer.ts` — shared ADR file I/O (create + update)
  - `src/helpers/claude-settings.ts` — additive `.claude/settings.local.json` merge
  - `src/helpers/init-project.ts` — shared `init` logic reusable by CLI and MCP

- [ ] **T2.5.6** Plugin marketplace setup
  - Future: publish plugin to Claude Code plugin marketplace

---

## Phase 3: Ecosystem & Distribution

**Goal:** Make Archgate adoptable by teams beyond the creator. ADR packs as sharable packages. Registry and discovery.

### Tasks

- [ ] **T3.1** ADR pack registry
  - npm-based distribution (packs are npm packages)
  - `archgate pack search <query>` — search available packs
  - Pack versioning (semver, teams pin versions)
  - `archgate pack publish` — publish custom packs

- [ ] **T3.2** Create starter ADR packs (moved from T1.5)
  - **`@archgate/pack-typescript`** — strict tsconfig rules, no any, naming conventions
  - **`@archgate/pack-testing`** — test file co-location, coverage thresholds
  - **`@archgate/pack-api-design`** — REST naming, error response format, OpenAPI requirements
  - Each pack is a standalone npm package with ADRs + rules

- [ ] **T3.3** Documentation site
  - Getting started guide (5-minute quickstart)
  - ADR authoring guide (how to write effective ADRs + rules)
  - Rule API reference (all built-in helpers)
  - Pack development guide (how to create and publish packs)
  - Integration guides (GitHub Actions, GitLab CI, Claude Code plugin)

- [ ] **T3.4** Community contribution workflow
  - ADR pack contribution guidelines
  - Review process for community packs
  - "Certified" badge for Archgate-reviewed packs

- [ ] **T3.5** Enterprise features (future)
  - ADR authoring UI (web app)
  - Compliance dashboard (per-team, per-project metrics)
  - Audit trail (log every check/review with results)
  - Team management (ADR pack assignments, role-based editing)

---

## Dependency Graph

```
Phase 0 (Foundation) ✅
  T0.1 ADR format spec ✅
  T0.2 Refactor init ✅
  T0.3 ADR commands (create/list/show/update) ✅
  T0.4 Testing infrastructure ✅
  T0.5 Self-dogfood ADRs ✅

Phase 1 (Check Engine) ✅
  T1.1 Rule loader ✅
  T1.2 Rule runtime ✅
  T1.3 Check command ✅
  T1.4 Pack system (simplified) ✅
  T1.5 Starter packs ── moved to Phase 3 (T3.2)
  T1.6 CI integration ✅
  T1.7 Self-dogfood ✅

Phase 2 (AI Integration) ✅ PIVOTED
  T2.1 MCP server (check, list_adrs, review_context, session_context) ✅
  T2.2 Review ── PIVOTED to plugin @architect skill
  T2.3 Capture ── PIVOTED to plugin @quality-manager skill
  T2.4 Skill generation ── REMOVED (replaced by review_context MCP tool)
  T2.5 Cost reporting ── REMOVED

Phase 2.5 (Claude Code Plugin) ✅
  T2.5.1 Plugin structure ✅
  T2.5.2 Role-based skills (architect, quality-manager, adr-author) ✅
  T2.5.3 Developer agent ✅
  T2.5.4 Rich review context (MCP + engine/context.ts) ✅
  T2.5.5 Shared helpers (adr-writer, claude-settings, init-project) ✅
  T2.5.6 Plugin marketplace ── NEXT

Phase 3 (Ecosystem)
  T3.1 Registry ── depends on T1.4
  T3.2 Starter packs ── depends on T1.4, T1.2
  T3.3 Documentation ── depends on T1.3
  T3.4 Community ── depends on T3.1
  T3.5 Enterprise ── depends on T3.1
```

## Priority Order (What to Build Next)

1. **T3.2** — Starter packs (first external-facing value)
2. **T3.3** — Documentation site (needed for adoption)
3. **T2.5.6** — Plugin marketplace distribution
4. **T3.1** — Pack registry (ecosystem play)
5. Everything else

## Success Criteria Per Phase

| Phase     | Done When                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0   | ~~`archgate init` creates governance skeleton, `archgate adr create/list` works, CLI is self-governed by its own ADRs~~ ✅                                                            |
| Phase 1   | ~~`archgate check` catches real violations in CI, the CLI itself passes `archgate check`~~ ✅ (starter packs moved to Phase 3)                                                        |
| Phase 2   | ~~MCP server works with Claude Code, skill generation converts ADRs~~ ✅ (review/capture pivoted to plugin)                                                                           |
| Phase 2.5 | ~~Claude Code plugin ships with CLI. Skills (`@architect`, `@quality-manager`, `@adr-author`) and developer agent orchestrate governance. MCP tools provide rich review context.~~ ✅ |
| Phase 3   | External teams adopt Archgate, community packs exist, documentation is complete                                                                                                       |
