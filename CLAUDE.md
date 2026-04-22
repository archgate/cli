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

The npm package is a **thin shim** — it contains only `bin/archgate.cjs` and `scripts/postinstall.cjs`. The shim downloads the platform binary from GitHub Releases on first run and caches it to `~/.archgate/bin/`. All runtime dependencies (commander, inquirer, zod) are bundled into the compiled binary via `bun build --compile`, so they belong in `devDependencies`, not `dependencies`.

## Conventions

- Commands export `register*Command(program)`, handle I/O only — no business logic
- OS: macOS, Linux, and Windows
- Output: `styleText()` from `node:util`; `--json` for machine-readable; auto-compact JSON in agent contexts (non-TTY, non-CI); no emoji
- Exit codes: 0 = success, 1 = violation, 2 = internal error, 130 = user cancellation (SIGINT)
- Deps: minimal; prefer Bun built-ins (see ARCH-006)

## Toolchain

See `.prototools` for pinned tool versions. Minimum user-facing Bun version is enforced in `src/cli.ts`.

## Self-Governance ADRs

The CLI dogfoods itself — see `.archgate/adrs/` for the full list of ADRs and their companion `.rules.ts` files. Read them before making architectural changes.

## ADR Format

YAML frontmatter (`id`, `title`, `domain`, `rules`, optional `files`). Sections: Context, Decision, Do's and Don'ts, Consequences, Compliance, References. Companion `.rules.ts` exports a plain object `satisfies RuleSet`.

## Adding a New Editor Target

Editor integrations share the `EditorTarget` union. Adding a new editor requires coordinated edits — missing any one breaks detection, init, or tests:

1. `src/helpers/init-project.ts` — extend `EditorTarget` union, `EDITOR_LABELS`, the `configureEditorSettings` switch, and (when authenticated install applies) the `tryInstallPlugin` branch
2. `src/helpers/plugin-install.ts` — add `is<Editor>CliAvailable()` and any install/download helper
3. `src/helpers/editor-detect.ts` — append to the `Promise.all` and the returned array
4. `src/commands/init.ts` — extend `EDITOR_DIRS`, `SIGNUP_EDITORS`, the `--editor` `.choices([...] as const)`, and `printManualInstructions`
5. `src/commands/plugin/install.ts` — extend `.choices([...] as const)` and add a case to `installForEditor` + the manual-instructions `catch`
6. `src/commands/plugin/url.ts` — extend `.choices([...] as const)` and branch before the URL ternary
7. Tests that assert the exact choice list: `tests/commands/plugin/install.test.ts`, `tests/commands/plugin/url.test.ts`, and `tests/helpers/editor-detect.test.ts` (length + id order)

User-scope editors (e.g., opencode) write to a path resolved in `paths.ts` rather than the project tree — `configureEditorSettings` returns that path for the init summary and the real work happens in `tryInstallPlugin`.

**Match the target editor's actual path resolution — don't assume Windows conventions.** opencode uses the `xdg-basedir` npm package, which falls back to `~/.config` on **all platforms** (including Windows, where it resolves to `C:\Users\<user>\.config\…`, not `%APPDATA%\…`). `opencodeAgentsDir()` must mirror that exact logic or the CLI writes files the editor can't find. When adding a user-scope editor, verify the editor's path helper in its source before writing the resolver.
