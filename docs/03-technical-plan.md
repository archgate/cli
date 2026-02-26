# Archgate Technical Plan: Architecture, Technologies, and Self-Governance

## Guiding Principle: Archgate Governs Itself

The CLI is developed using its own governance model. The ADR format, check engine, and review tools are used to build the CLI itself. This ensures:

1. The format is practical (we feel the pain of bad design immediately)
2. The check engine works on a real codebase (not just toy examples)
3. The documentation stays honest (we write what we actually use)

---

## Technology Stack

### Runtime & Language

| Choice        | Technology                                       | Rationale                                                                                                                |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Runtime       | **Bun** (>=1.2.21)                               | Fast startup, native TypeScript, built-in test runner, `Bun.file`/`Bun.write` APIs. Single binary distribution possible. |
| Language      | **TypeScript** (strict mode)                     | Type safety for the CLI internals and for the rule authoring API. Users write rules in TypeScript.                       |
| CLI Framework | **Commander.js** (`@commander-js/extra-typings`) | Mature, type-safe, supports subcommands.                                                                                 |

### AI Integration

| Choice               | Technology                       | Rationale                                                                                                                                                                                              |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Integration Protocol | **MCP (Model Context Protocol)** | The `archgate mcp` server exposes tools (check, list_adrs, review_context, claude_code_session_context) and resources (adr://{id}) to any MCP-compatible client. Uses `@modelcontextprotocol/sdk`.     |
| AI Features          | **Claude Code Plugin**           | Role-based skills (architect, quality-manager, adr-author) and developer agent delivered as a Claude Code plugin (`plugin/`). Claude Code handles all AI interactions — no direct Anthropic API calls. |
| Multi-LLM (future)   | **MCP-based**                    | Any MCP-compatible AI client can use archgate MCP tools. Not locked to a single provider.                                                                                                              |

### Check Engine

| Choice                | Technology                  | Rationale                                                                                         |
| --------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| Rule execution        | **Bun native TS execution** | Rules are `.rules.ts` files. Bun executes TypeScript directly -- no build step needed.            |
| File operations       | **Bun glob + native fs**    | `Bun.file()` for reading, `Bun.Glob` for pattern matching. Fast, no dependencies.                 |
| Git integration       | **`git ls-files`**          | Used to respect `.gitignore` and scope to tracked files. `git diff --staged` for pre-commit mode. |
| Config parsing        | **YAML frontmatter**        | ADR configuration is embedded in YAML frontmatter within `.md` files. No separate config file.    |
| AST analysis (future) | **oxc-parser**              | For rules that need AST-level checks (e.g., "no default exports"). Oxc is fast and Rust-based.    |

### Testing & Quality

| Choice             | Technology                            | Rationale                                 |
| ------------------ | ------------------------------------- | ----------------------------------------- |
| Test runner        | **Bun test**                          | Built-in, fast, compatible with Jest API. |
| Linting            | **Oxlint**                            | Fast, no config bloat.                    |
| Formatting         | **Prettier**                          | Consistent formatting.                    |
| Commit conventions | **Commitlint + Conventional Commits** | Semantic versioning from commit messages. |

### Distribution

| Choice                       | Technology       | Rationale                                                                          |
| ---------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| Package registry             | **npm**          | Primary distribution. `npm install -g archgate` or `bun add -g archgate`.          |
| Binary distribution (future) | **Bun compile**  | `bun build --compile` produces a single binary. No runtime dependency.             |
| ADR packs                    | **npm packages** | Packs are npm packages with a standard structure. Installed to `.archgate/packs/`. |

---

## CLI Architecture (Implemented)

### Directory Layout

```
archgate/cli/
├── .archgate/                    # Self-governance (dogfood)
│   ├── adrs/                    # ADRs governing CLI development
│   └── lint/                    # Linter-specific rules (e.g., oxlint plugins)
│       ├── ARCH-001-command-structure.md + .rules.ts
│       ├── ARCH-002-error-handling.md + .rules.ts
│       ├── ARCH-003-output-formatting.md + .rules.ts
│       ├── ARCH-004-no-barrel-files.md + .rules.ts
│       ├── ARCH-005-testing-standards.md + .rules.ts
│       └── ARCH-006-dependency-policy.md + .rules.ts
├── docs/                        # Strategic, tactical, technical plans
├── plugin/                      # Static Claude Code plugin (ships with npm)
│   ├── settings.json            # Default agent + MCP tool permissions
│   ├── agents/
│   │   └── developer.md         # Developer agent (orchestrates governance workflow)
│   └── skills/                  # Model-invoked skills
│       ├── architect/SKILL.md   # Architecture review role
│       ├── quality-manager/SKILL.md  # Learning capture role
│       └── adr-author/SKILL.md  # ADR authoring role
├── src/
│   ├── cli.ts                   # Entry point, command registration
│   ├── commands/                # One file per command (register*Command pattern)
│   │   ├── init.ts
│   │   ├── check.ts
│   │   ├── mcp.ts
│   │   ├── upgrade.ts
│   │   ├── clean.ts
│   │   └── adr/
│   │       ├── index.ts         # Registers adr subcommand group
│   │       ├── create.ts
│   │       ├── list.ts
│   │       ├── show.ts
│   │       └── update.ts
│   ├── engine/                  # Check engine core
│   │   ├── context.ts           # Review context building (section extraction, domain matching)
│   │   ├── loader.ts            # Load and parse .rules.ts files
│   │   ├── runner.ts            # Execute rules, collect results
│   │   └── reporter.ts          # Format and output results (console, JSON, CI)
│   ├── mcp/                     # MCP server
│   │   ├── server.ts            # MCP server creation + stdio transport
│   │   ├── resources.ts         # MCP resource registrations (adr://{id})
│   │   └── tools/               # MCP tool registrations (one per file)
│   │       ├── index.ts         # Composes all tool registrations
│   │       ├── check.ts
│   │       ├── list-adrs.ts
│   │       ├── review-context.ts
│   │       ├── claude-code-session-context.ts
│   │       └── cursor-session-context.ts
│   ├── formats/                 # Zod schemas + parsers (single source of truth)
│   │   ├── adr.ts               # ADR frontmatter schema, parsing, validation
│   │   └── rules.ts             # Rule file schema + defineRules()
│   └── helpers/                 # Shared utilities
│       ├── paths.ts             # Path resolution (~/.archgate, .archgate/)
│       ├── git.ts               # Git operations (availability check)
│       ├── log.ts               # Logging (debug, info, error, warn)
│       ├── adr-templates.ts     # ADR template generation
│       ├── adr-writer.ts        # ADR file I/O (create + update)
│       ├── claude-settings.ts   # .claude/settings.local.json merge logic
│       ├── init-project.ts      # Project initialization logic
│       └── getParentFolderName.ts
├── tests/                       # Tests (mirrors src/)
│   ├── commands/
│   │   ├── adr/                 # Per-subcommand tests
│   │   ├── check.test.ts
│   │   ├── clean.test.ts
│   │   ├── init.test.ts
│   │   ├── mcp.test.ts
│   │   └── upgrade.test.ts
│   ├── engine/
│   ├── formats/
│   ├── helpers/
│   ├── mcp/
│   │   └── tools/               # Per-MCP-tool tests
│   └── fixtures/                # Sample ADRs, configs, codebases
├── package.json
├── tsconfig.json
└── bunfig.toml
```

### Command Structure (Implemented)

```
archgate
├── init [path]                  # Initialize governance in a project
├── check                        # Run automated ADR compliance checks
│   ├── --json                   # JSON output for CI
│   ├── --ci                     # GitHub Actions annotations format
│   ├── --staged                 # Only check staged files
│   ├── --adr <id>               # Check specific ADR only
│   └── --verbose                # Verbose output
├── adr
│   ├── create                   # Create new ADR (interactive)
│   ├── list                     # List all ADRs (--json, --domain)
│   ├── show <id>                # Display ADR content
│   └── update                   # Update existing ADR (--id, --title, --body, --domain)
├── mcp                          # Start MCP server (stdio)
├── upgrade                      # Upgrade CLI
└── clean                        # Clean cache (~/.archgate/)
```

---

## File Format Specifications

### ADR Document Format (Implemented)

ADRs are markdown files with YAML frontmatter:

```yaml
---
id: API-001
title: API routes must use underscore naming
domain: backend # backend | frontend | data | architecture | general
rules: true # whether a companion .rules.ts file exists
files: # optional -- glob patterns scoping which files this ADR applies to
  - "src/routes/**/*.ts"
---
```

Body sections: Context, Decision, Do's and Don'ts, Consequences (Positive/Negative/Risks), Compliance and Enforcement, References.

### Rule File (`.rules.ts`) (Implemented)

```typescript
import { defineRules } from "archgate/rules";

export default defineRules({
  "rule-name": {
    description: "What this rule checks",
    severity: "error",
    check: async ({
      glob,
      grep,
      grepFiles,
      readFile,
      readJSON,
      report,
      projectRoot,
      config,
      scopedFiles,
      changedFiles,
    }) => {
      // Rule implementation using RuleContext API
      const files = await glob("src/**/*.ts");
      for (const file of files) {
        const matches = await grep(file, /pattern/);
        for (const match of matches) {
          report.violation({
            file,
            line: match.line,
            message: "Violation description",
          });
        }
      }
    },
  },
});
```

---

## Check Engine Architecture (Implemented)

### Execution Flow

```
archgate check
  |
  |-- 1. Discover ADRs
  |     |-- Custom ADRs (.archgate/adrs/*.md where rules: true)
  |     |-- Pack ADRs (.archgate/packs/*/adrs/*.md where rules: true)
  |
  |-- 2. Load rule files
  |     |-- Import companion .rules.ts via Bun dynamic import
  |     -> Validate exports match RuleSet schema
  |
  |-- 3. Create execution context (RuleContext)
  |     |-- Inject helpers: glob, grep, grepFiles, readFile, readJSON, report
  |     |-- Apply per-ADR `files` scope (frontmatter globs)
  |     -> If --staged: filter to git staged files only
  |
  |-- 4. Execute rules
  |     |-- Parallel across ADRs
  |     |-- Sequential within each ADR
  |     -> 30s timeout per rule
  |
  |-- 5. Report results
  |     |-- Console: colored output with file:line references
  |     |-- JSON: structured output (--json flag)
  |     -> CI: GitHub Actions annotations (--ci flag)
  |
  |-- 6. Exit code
        |-- 0: all rules pass
        |-- 1: violations found
        -> 2: rule execution errors
```

---

## MCP Server Architecture (Implemented)

### Tools

| Tool                          | Description                                                                    | Input                       |
| ----------------------------- | ------------------------------------------------------------------------------ | --------------------------- |
| `check`                       | Run ADR compliance checks                                                      | `adrId?`, `staged?`         |
| `list_adrs`                   | List all active ADRs with metadata                                             | `domain?`                   |
| `review_context`              | Pre-compute review context: changed files grouped by domain with ADR briefings | `staged?`, `runChecks?`     |
| `claude_code_session_context` | Read Claude Code session transcript for context recovery                       | `maxEntries?`               |
| `cursor_session_context`      | Read Cursor agent session transcripts                                          | `maxEntries?`, `sessionId?` |

### Resources

| URI Pattern  | Description               |
| ------------ | ------------------------- |
| `adr://{id}` | Full ADR markdown content |

---

## Plugin Architecture (Implemented)

### Overview

AI-powered governance features are delivered as a Claude Code plugin (`plugin/`). The plugin ships with the npm package and provides role-based skills and a developer agent that orchestrate governance workflows.

### Plugin Structure

| Component             | File                              | Purpose                                                              |
| --------------------- | --------------------------------- | -------------------------------------------------------------------- |
| Settings              | `settings.json`                   | Default agent config + MCP tool permissions                          |
| Developer agent       | `agents/developer.md`             | Orchestrates UNDERSTAND → PLAN → WRITE → VALIDATE → CAPTURE workflow |
| Architect skill       | `skills/architect/SKILL.md`       | Architecture review role (validates code against ADRs)               |
| Quality manager skill | `skills/quality-manager/SKILL.md` | Learning capture role (proposes ADR updates/creation)                |
| ADR author skill      | `skills/adr-author/SKILL.md`      | ADR authoring role (creates/edits ADRs following conventions)        |

### How the Plugin Works

The developer agent is the entry point. It enforces a strict workflow:

1. **UNDERSTAND** — Calls `review_context` MCP tool to get condensed ADR briefings before coding
2. **PLAN** — Designs implementation to comply with all applicable ADRs
3. **WRITE** — Implements code following ADR constraints
4. **VALIDATE** — Runs `check` MCP tool + invokes `@architect` skill for structural compliance
5. **CAPTURE** — Invokes `@quality-manager` skill to capture learnings and propose new ADRs

The MCP tools (`check`, `list_adrs`, `review_context`, `claude_code_session_context`) provide the data layer. The skills provide the judgment layer. The agent provides the orchestration layer.

---

## Self-Governance ADRs (Implemented)

Six ADRs governing CLI development, each with executable `.rules.ts`:

| ADR      | Scope             | Key Rules                                                           |
| -------- | ----------------- | ------------------------------------------------------------------- |
| ARCH-001 | Command structure | Commands export `register*Command()`, no business logic in commands |
| ARCH-002 | Error handling    | Exit codes 0/1/2, human-readable errors                             |
| ARCH-003 | Output formatting | Use `styleText()`, support `--json`, no emoji                       |
| ARCH-004 | No barrel files   | Direct imports only, no re-export-only index.ts                     |
| ARCH-005 | Testing standards | Bun test runner, fixtures in `tests/fixtures/`                      |
| ARCH-006 | Dependency policy | Minimal deps, approved list (commander, inquirer, mcp sdk, zod)     |

---

## Build & Distribution Pipeline

### Development

```bash
# Run CLI locally
bun run src/cli.ts <command>

# Run tests
bun test

# Lint + format + typecheck
bun run lint
bun run typecheck
bun run format:check

# Self-check
bun run src/cli.ts check

# Full validation (mandatory before completing any task)
bun run validate
```

### CI Pipeline (Implemented)

```
Push / PR
  |-- bun install (frozen lockfile)
  |-- bun run lint (oxlint)
  |-- bun run typecheck (tsc --build)
  |-- bun test
  |-- commitlint (PR title validation)
```

### Release (Implemented)

```
Merge to main
  |-- Semantic version bump (from conventional commits)
  |-- Publish to npm via @simple-release/npm
  -> Create GitHub release
```

### Binary Distribution (Future)

```bash
bun build --compile --target=bun-linux-x64 src/cli.ts --outfile=archgate-linux-x64
bun build --compile --target=bun-darwin-arm64 src/cli.ts --outfile=archgate-darwin-arm64
```

---

## Migration from Original CLI ✅ COMPLETE

All migration steps have been executed:

- [x] Kept: `src/cli.ts` entry point, `src/helpers/`, Commander.js setup, dev tooling config
- [x] Refactored: init command to governance-first approach
- [x] Removed: `archgate start`, `archgate frontend` (premature/opinionated)
- [x] Removed: `archgate review`, `archgate capture`, `archgate stats`, `archgate generate-skills` (pivoted to plugin)
- [x] Removed: `archgate pack add/list/remove`, `archgate plugin generate`, `archgate adr deprecate` (simplified)
- [x] Removed: `@anthropic-ai/sdk` dependency (ToS compliance)
- [x] Removed: `src/agent/` module (skill/plugin generation replaced by static plugin + MCP tools)
- [x] Removed: `src/formats/config.ts`, `src/formats/pack.ts`, `src/formats/index.ts` (simplified to adr.ts + rules.ts)
- [x] Added: `src/engine/context.ts` (review context building for AI tools)
- [x] Added: `src/helpers/adr-writer.ts`, `claude-settings.ts`, `init-project.ts` (shared logic)
- [x] Added: `src/commands/adr/update.ts` (complete ADR lifecycle)
- [x] Added: `src/mcp/tools/` directory with `review-context.ts`, `claude-code-session-context.ts` (rich AI context)
- [x] Added: `.archgate/` self-governance directory with 6 ADRs + rules
- [x] Added: `tests/` with comprehensive test coverage (30+ test files)
