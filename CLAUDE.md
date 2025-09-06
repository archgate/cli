# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Archgate is a CLI tool for AI governance in software development. It enforces Architecture Decision Records (ADRs) as executable rules — combining human-readable documents with machine-checkable checks.

The CLI dogfoods itself: its own development is governed by Archgate ADRs stored in `.archgate/adrs/`.

AI-powered features (review, capture) are delivered as a **Claude Code plugin** in a separate repository (`archgate/claude-code-plugin`), not via direct Anthropic API calls. The CLI remains standalone for deterministic operations.

## Technology Stack

- **Runtime:** Bun (>=1.2.21) — not Node.js compatible
- **Language:** TypeScript (strict mode, ESNext target, ES modules)
- **CLI framework:** Commander.js (`@commander-js/extra-typings`)
- **Linter:** Oxlint
- **Formatter:** Prettier
- **Commits:** Conventional Commits enforced by commitlint

## Commands

```bash
# Run the CLI locally
bun run src/cli.ts <command>

# Lint
bun run lint            # runs oxlint

# Type check
bun run typecheck       # runs tsc --build

# Format check
bun run format:check    # runs prettier --check

# Format fix
bun run format          # runs prettier --write

# Tests
bun test                # runs all tests
bun run test:watch      # watch mode

# Full repo validation (MANDATORY before completing any task)
bun run validate        # runs lint + typecheck + prettier + test + ADR check

# Build standalone binaries
bun run build           # builds all targets (darwin-arm64, linux-x64)
bun run build:darwin    # builds macOS arm64 binary only
bun run build:linux     # builds Linux x64 binary only

# Commit with conventional commit wizard
bun run commit
```

Binaries are output to `dist/`. Each binary has a companion `.sha256` checksum file.

## Validation Gate

**`bun run validate` must pass before any task is considered complete.** This is a hard requirement for all agents and developers. The script runs the full validation pipeline in order:

1. **Lint** (`oxlint .`) — Static analysis
2. **Typecheck** (`tsc --build`) — Type safety
3. **Format** (`prettier --check .`) — Code formatting
4. **Test** (`bun test`) — All unit and integration tests
5. **ADR check** (`archgate check`) — Architecture Decision Record compliance

The pipeline is fail-fast: if any step fails, subsequent steps do not run. Fix all failures before proceeding. This mirrors the CI pipeline in `.github/workflows/code-pull-request.yml`.

## Architecture

### Entry Point & Command Registration

`src/cli.ts` is the entry point (shebang `#!/usr/bin/env bun`). It performs bootstrap checks (Bun version, OS compatibility, Git availability), then explicitly imports and registers commands via `register*Command(program)` functions. It also starts a background update check that prints a notice after the command completes.

### Current Commands

| Command         | File                     | Description                                          |
| --------------- | ------------------------ | ---------------------------------------------------- |
| `init`          | `commands/init.ts`       | Initialize `.archgate/` governance skeleton          |
| `check`         | `commands/check.ts`      | Run automated ADR compliance checks                  |
| `adr create`    | `commands/adr/create.ts` | Create a new ADR interactively                       |
| `adr list`      | `commands/adr/list.ts`   | List all ADRs (supports `--json`, `--domain` filter) |
| `adr show <id>` | `commands/adr/show.ts`   | Display a specific ADR by ID                         |
| `adr update`    | `commands/adr/update.ts` | Update an existing ADR by ID                         |
| `mcp`           | `commands/mcp.ts`        | Start MCP server for AI tool integration             |
| `upgrade`       | `commands/upgrade.ts`    | Upgrade the CLI binary via GitHub Releases           |
| `clean`         | `commands/clean.ts`      | Remove `~/.archgate/` cache directory                |

### Claude Code Plugin (separate repo)

The Claude Code plugin lives in `archgate/claude-code-plugin` (https://github.com/archgate/claude-code-plugin). It provides AI-powered governance features: a developer agent (`archgate:developer`), role-based skills (architect, quality-manager, adr-author, onboard), and MCP connection to `archgate mcp`. The plugin's `.mcp.json` calls `archgate mcp` — the binary must be installed and in PATH first.

Run `archgate:onboard` once to initialize governance for a new project.

### Formats (`src/formats/`)

| Module     | Purpose                                                                          |
| ---------- | -------------------------------------------------------------------------------- |
| `adr.ts`   | ADR frontmatter Zod schema, types (derived via `z.infer<>`), parsing, validation |
| `rules.ts` | `RuleSetSchema`, `RuleConfig`, `RuleContext`, `defineRules()`                    |

**Validation convention:** Zod schemas are the single source of truth for data shapes. TypeScript types are derived from schemas via `z.infer<>` — never define separate interfaces. Use `safeParse()` for validation and to get typed data without unsafe casts. Reuse schema shapes (e.g., `AdrFrontmatterSchema.shape.domain`) across commands and MCP tools to avoid duplicating enums.

### Helpers (`src/helpers/`)

| Module                   | Purpose                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `paths.ts`               | Manages `~/.archgate/` (internal cache) and `.archgate/` (project governance) paths |
| `log.ts`                 | `logDebug`, `logInfo`, `logError`, `logWarn` using `styleText` from `node:util`     |
| `adr-templates.ts`       | Generate example ADR and blank ADR templates                                        |
| `adr-writer.ts`          | Write and update ADR markdown files on disk                                         |
| `init-project.ts`        | Initialize `.archgate/` project structure and Claude plugin settings                |
| `claude-settings.ts`     | Manage `.claude/settings.local.json` for Archgate plugin integration                |
| `git.ts`                 | Check for Git; auto-install via Homebrew (macOS) or apt (Linux)                     |
| `getParentFolderName.ts` | Extract project name from git root or folder basename                               |
| `update-check.ts`        | Background version check against GitHub Releases (24h cache, non-fatal)             |

### Key Paths

- `~/.archgate/` — CLI cache and downloaded templates
- `~/.archgate/bin/` — Default binary install location (used by install script)
- `.archgate/` — Project governance directory (per-project)
- `.archgate/adrs/` — Architecture Decision Records
- `.archgate/lint/` — Linter-specific rules (e.g., oxlint plugins)

### Tests (`tests/`)

Tests use Bun's built-in test runner. Structure mirrors `src/`:

- `tests/formats/` — Unit tests for parsers and types
- `tests/commands/` — Integration tests for commands
- `tests/fixtures/` — Sample ADR files

## Conventions

- **Command files** export `register*Command(program)` functions, imported in `src/cli.ts`
- **Commands handle I/O only** — parse args, call engine/helpers, format output; no business logic in commands
- **OS support:** macOS and Linux only (Windows blocked, WSL2 recommended)
- **Dependencies:** Minimal production deps. Prefer Bun built-ins. See `.archgate/adrs/ARCH-006-dependency-policy.md`.
- **Output:** Use `styleText()` from `node:util` for colored output. Support `--json` for machine-readable output. No emoji in CLI output.
- **Exit codes:** 0 = success, 1 = violation/failure, 2 = internal error
- **Testing:** Bun test runner, fixtures in `tests/fixtures/`, temp dirs for filesystem tests

## CI/CD

Three GitHub Actions workflows:

- **`code-pull-request.yml`** — On PR: validates PR title with commitlint, runs `bun run validate` (lint + typecheck + format + test + ADR check). Skips drafts.
- **`release.yml`** — On push to main: creates release PR or publishes release via `@simple-release/npm`. Runs `bun run validate` before publish.
- **`release-binaries.yml`** — On GitHub Release published: builds darwin-arm64 and linux-x64 binaries, uploads to the release, and updates the Homebrew tap formula.

Release is automated via conventional commits (semantic versioning from commit messages).

## Toolchain

Managed via Proto (`.prototools`):

- Bun 1.3.8
- Moon 1.39.4
- Node LTS
- npm 11.6.0

## Self-Governance ADRs

The CLI's own ADRs are in `.archgate/adrs/`:

- `ARCH-001` — Command structure (register pattern, no business logic)
- `ARCH-002` — Error handling (exit codes, logError)
- `ARCH-003` — Output formatting (styleText, --json, no emoji)
- `ARCH-004` — No barrel files (direct imports, no re-export-only index.ts)
- `ARCH-005` — Testing standards (Bun test, fixtures, 80% coverage)
- `ARCH-006` — Dependency policy (minimal deps, Bun built-ins)

## ADR Format

ADRs are markdown files with YAML frontmatter (`id`, `title`, `domain`, `rules`, optional `files` globs). Body sections: Context, Decision, Do's and Don'ts, Consequences (Positive/Negative/Risks), Compliance and Enforcement, References. Companion `.rules.ts` files export check functions via `defineRules()`.
