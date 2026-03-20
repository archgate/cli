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

Entry point: `src/cli.ts` (shebang `#!/usr/bin/env bun`). Commands registered via `register*Command(program)`. See `src/commands/` for all command implementations — each file exports a `register*Command(program)` function.

### Key Paths

- `~/.archgate/` — CLI cache; `~/.archgate/bin/` — binary install location
- `.archgate/adrs/` — ADRs; `.archgate/lint/` — linter rules
- `src/formats/` — Zod schemas + types (`adr.ts`, `rules.ts`)
- `src/helpers/` — utilities (paths, log, git, templates, adr-writer, etc.)
- `tests/` — mirrors `src/`; fixtures in `tests/fixtures/`

### Formats & Validation

Zod schemas are the single source of truth. Types derived via `z.infer<>` — never define separate interfaces. Use `safeParse()`. Reuse `AdrFrontmatterSchema.shape.*` to avoid duplicating enums.

## npm Distribution

The npm package is a **thin shim** — it contains only `bin/archgate.cjs` and `scripts/postinstall.cjs`. The postinstall script downloads the prebuilt platform binary. All runtime dependencies (commander, inquirer, zod) are bundled into the compiled binary via `bun build --compile`, so they belong in `devDependencies`, not `dependencies`. The `optionalDependencies` (archgate-darwin-arm64, etc.) are platform-specific binary packages synced to the CLI version by `.simple-release.js` during release.

## Conventions

- Commands export `register*Command(program)`, handle I/O only — no business logic
- OS: macOS, Linux, and Windows
- Output: `styleText()` from `node:util`; `--json` for machine-readable; no emoji
- Exit codes: 0 = success, 1 = violation, 2 = internal error
- Deps: minimal; prefer Bun built-ins (see ARCH-006)

## Toolchain

See `.prototools` for pinned tool versions. Minimum user-facing Bun version is enforced in `src/cli.ts`.

## Self-Governance ADRs

The CLI dogfoods itself — see `.archgate/adrs/` for the full list of ADRs and their companion `.rules.ts` files. Read them before making architectural changes.

## ADR Format

YAML frontmatter (`id`, `title`, `domain`, `rules`, optional `files`). Sections: Context, Decision, Do's and Don'ts, Consequences, Compliance, References. Companion `.rules.ts` exports a plain object `satisfies RuleSet`.
