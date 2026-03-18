# CLAUDE.md

Archgate is a CLI tool for AI governance via Architecture Decision Records (ADRs) — combining human-readable docs with machine-checkable rules. The CLI dogfoods itself via ADRs in `.archgate/adrs/`. AI features are delivered as a Claude Code plugin (`../plugins/claude-code`), not via direct API calls.

## Technology Stack

- **Runtime:** Bun (>=1.2.21) — not Node.js compatible
- **Language:** TypeScript (strict mode, ESNext, ES modules)
- **CLI framework:** Commander.js (`@commander-js/extra-typings`)
- **Linter:** Oxlint | **Formatter:** Oxfmt | **Commits:** Conventional Commits

## Commands

```bash
bun run src/cli.ts <command>  # run CLI locally
bun run lint                  # oxlint
bun run typecheck             # tsc --build
bun run format                # oxfmt --write
bun run format:check          # oxfmt --check
bun test                      # all tests
bun run validate              # MANDATORY: lint + typecheck + format + test + ADR check + build check
bun run build:check            # verify build compiles (CI builds binaries via release workflow)
bun run commit                # conventional commit wizard
```

## Validation Gate

**`bun run validate` must pass before any task is considered complete.** Fail-fast pipeline: lint → typecheck → format → test → ADR check → build check. Mirrors CI in `.github/workflows/code-pull-request.yml`.

## Architecture

### Commands

Entry point: `src/cli.ts` (shebang `#!/usr/bin/env bun`). Commands registered via `register*Command(program)`.

| Command                       | File                                      | Description                                                     |
| ----------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| `init`                        | `commands/init.ts`                        | Initialize Archgate governance in the current project           |
| `check`                       | `commands/check.ts`                       | Run ADR compliance checks                                       |
| `adr create`                  | `commands/adr/create.ts`                  | Create a new ADR                                                |
| `adr list`                    | `commands/adr/list.ts`                    | List all ADRs (`--json`, `--domain`)                            |
| `adr show <id>`               | `commands/adr/show.ts`                    | Show a specific ADR by ID                                       |
| `adr update`                  | `commands/adr/update.ts`                  | Update an existing ADR by ID                                    |
| `login`                       | `commands/login.ts`                       | Authenticate with GitHub to access archgate plugins             |
| `login status`                | `commands/login.ts`                       | Show current authentication status                              |
| `login logout`                | `commands/login.ts`                       | Remove stored credentials                                       |
| `login refresh`               | `commands/login.ts`                       | Re-authenticate and claim a new token                           |
| `review-context`              | `commands/review-context.ts`              | Pre-compute review context with ADR briefings for changed files |
| `session-context`             | `commands/session-context/index.ts`       | Read AI editor session transcripts                              |
| `session-context claude-code` | `commands/session-context/claude-code.ts` | Read Claude Code session transcript for the project             |
| `session-context cursor`      | `commands/session-context/cursor.ts`      | Read Cursor agent session transcript for the project            |
| `plugin`                      | `commands/plugin/index.ts`                | Manage archgate editor plugins                                  |
| `plugin install`              | `commands/plugin/install.ts`              | Install the archgate plugin for the specified editor            |
| `plugin url`                  | `commands/plugin/url.ts`                  | Print the authenticated plugin repository URL                   |
| `upgrade`                     | `commands/upgrade.ts`                     | Upgrade Archgate to the latest version                          |
| `clean`                       | `commands/clean.ts`                       | Clean the CLI temp files                                        |

### Key Paths

- `~/.archgate/` — CLI cache; `~/.archgate/bin/` — binary install location
- `.archgate/adrs/` — ADRs; `.archgate/lint/` — linter rules
- `src/formats/` — Zod schemas + types (`adr.ts`, `rules.ts`)
- `src/helpers/` — utilities (paths, log, git, templates, adr-writer, etc.)
- `tests/` — mirrors `src/`; fixtures in `tests/fixtures/`

### Formats & Validation

Zod schemas are the single source of truth. Types derived via `z.infer<>` — never define separate interfaces. Use `safeParse()`. Reuse `AdrFrontmatterSchema.shape.*` to avoid duplicating enums.

## Conventions

- Commands export `register*Command(program)`, handle I/O only — no business logic
- OS: macOS, Linux, and Windows
- Output: `styleText()` from `node:util`; `--json` for machine-readable; no emoji
- Exit codes: 0 = success, 1 = violation, 2 = internal error
- Deps: minimal; prefer Bun built-ins (see ARCH-006)

## Toolchain (`.prototools`)

Bun 1.3.9, Node LTS, npm 11.11.0. Minimum user-facing Bun: `>=1.2.21` (enforced in `src/cli.ts`).

## Self-Governance ADRs (`.archgate/adrs/`)

- `ARCH-001` — Command structure (register pattern, no business logic)
- `ARCH-002` — Error handling (exit codes, logError)
- `ARCH-003` — Output formatting (styleText, --json, no emoji)
- `ARCH-004` — No barrel files (direct imports only)
- `ARCH-005` — Testing standards (Bun test, fixtures, 80% coverage)
- `ARCH-006` — Dependency policy (minimal deps, Bun built-ins)
- `ARCH-007` — Cross-platform subprocess execution (Bun.spawn, no Bun.$)
- `ARCH-008` — Typed command options (use addOption for choices/argParser)
- `ARCH-009` — Centralized platform detection (use helpers/platform)
- `GEN-001` — Documentation site (Astro Starlight)
- `GEN-002` — Documentation internationalization (en + pt-br parity)

## ADR Format

YAML frontmatter (`id`, `title`, `domain`, `rules`, optional `files`). Sections: Context, Decision, Do's and Don'ts, Consequences, Compliance, References. Companion `.rules.ts` exports `defineRules()`.
