# CLAUDE.md

Archgate is a CLI tool for AI governance via Architecture Decision Records (ADRs) — combining human-readable docs with machine-checkable rules. The CLI dogfoods itself via ADRs in `.archgate/adrs/`. AI features are delivered as a Claude Code plugin (`../plugins/claude-code`), not via direct API calls.

## Technology Stack

- **Runtime:** Bun (>=1.2.21) — not Node.js compatible
- **Language:** TypeScript (strict mode, ESNext, ES modules)
- **CLI framework:** Commander.js (`@commander-js/extra-typings`)
- **Linter:** Oxlint | **Formatter:** Oxfmt | **Dead exports:** Knip | **Commits:** Conventional Commits

## Commands

```bash
bun run src/cli.ts <command>  # run CLI locally
bun run lint                  # oxlint
bun run typecheck             # tsc --build
bun run format                # oxfmt --write
bun run format:check          # oxfmt --check
bun run test                  # all tests (not bare `bun test` — picks up --timeout; see GEN-003)
bun run knip                  # dead export detection
bun run validate              # MANDATORY: lint + typecheck + format + test + ADR check + knip + build check
bun run build:check            # verify build compiles (CI builds binaries via release workflow)
bun run commit                # conventional commit wizard
```

## Validation Gate

**`bun run validate` must pass before any task is considered complete.** Fail-fast pipeline: lint → typecheck → format → test → ADR check → knip → build check. Mirrors CI in `.github/workflows/code-pull-request.yml`.

## Git Hooks (Git 2.54+)

Config-based hooks in `.githooks` run validation locally before commits and pushes:

- **pre-commit:** lint + typecheck + format:check (~15s)
- **pre-push:** full `bun run validate` (~60s, mirrors CI)

Activate once per clone:

```bash
git config --local include.path ../.githooks
```

Opt out of a specific hook: `git config --local hook.<name>.enabled false`. Skip all hooks for a single commit: `git commit --no-verify`.

## GitHub Actions: `secrets.*` vs `vars.*`

Distinct, non-overlapping namespaces — a repo **secret** is not readable via `vars.*`, and vice versa. (`release.yml`'s PostHog annotation step once read `vars.POSTHOG_PROJECT_ID` when the value only existed as a **secret**, silently no-opping for weeks behind `continue-on-error: true` + a low-visibility `::notice::`.) Before wiring a new reference, confirm the value's actual location with `gh secret list` / `gh variable list`. For any `continue-on-error` step with a skip-on-missing-config guard, use `::warning::` (not `::notice::`) so misconfiguration is visible in the Actions UI.

## Release Pipeline Gotchas

- **Chain downstream release workflows, don't parallel-trigger them.** `publish-shims.yml` has no `release: published` trigger — `release-binaries.yml`'s `trigger-shim-publish` job dispatches it (`gh workflow run`) after binaries + provenance succeed. Two workflows both listening to `release: published` races: if the build needs a retry, a fixed-budget wait job can time out (`cancelled`, terminal) before the retry finishes.
- **`moonrepo/setup-toolchain`'s cache can silently break PATH.** Right after a `.prototools` bump, the first macOS/Windows CI run often restores a stale `restore-key` cache instead of an exact hit (check the log for `Cache hit for restore-key:`) — the action reports success but `bun` isn't wired onto PATH. Self-heals on retry (the failed job still saves a fresh exact-key cache).
- **The CLI's background update-check notice can pollute stdout.** `checkForUpdatesIfNeeded()` prints to stdout after command output; `shouldPerformUpdateCheck()` in `src/helpers/update-check.ts` gates it to TTY-only, non-CI, non-`upgrade` sessions so piped/agent JSON output isn't corrupted.

## Claude Code Harness Config (`.claude/settings.json`)

`hooks.WorktreeCreate` is **not** a post-creation setup step — once configured, the harness defers the _entire_ worktree creation to it. The hook gets `{ "cwd", "name", ... }` on stdin and **must** create the worktree itself, printing _only_ the final absolute path as its last stdout line — any other stdout (unsilenced `bun install`/`git worktree add` output) gets misread as the path, breaking `EnterWorktree`/`ExitWorktree` (`path contains control characters`, `ENOENT: ... chdir`). Redirect all setup output to `>&2`. Don't simplify this back to a bare `bun install` — see [the full bug history](.claude/agent-memory/archgate-developer/project_worktree_create_hook_contract.md) (5 rounds of fixes, all worth re-testing if this hook changes).

**Command-type hooks with POSIX syntax MUST set `"shell": "bash"` explicitly**, even on Windows with Git Bash installed — hooks have a separate shell-detection path from the interactive `Bash` tool and can silently fall back to `cmd.exe` without it (symptom: `'x' is not recognized as an internal or external command...`). If Git Bash still isn't found, Claude Code checks `CLAUDE_CODE_GIT_BASH_PATH` → `C:\Program Files\Git\bin\bash.exe` (or x86) → `git` on PATH resolved to `../../bin/bash.exe`.

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

The npm package is a **thin shim** — it contains only `bin/archgate.cjs`. The shim downloads the platform binary from GitHub Releases on first run and caches it to `~/.archgate/bin/`. All runtime dependencies (commander, inquirer, zod) are bundled into the compiled binary via `bun build --compile`, so they belong in `devDependencies`, not `dependencies`.

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
2. `src/helpers/plugin-install.ts` — add `is<Editor>CliAvailable()` and any install/download helper. For tarball-based editors (no marketplace CLI), use `installEditorPluginBundle()` — it handles directory creation, old-file cleanup, and tarball extraction in one call. If the editor also ships a GUI/Desktop distribution with no CLI binary at all, add a broader `is<Editor>Available()` that OR's in a shared-state fallback (e.g., the editor's user-scope config directory already existing) — see the opencode Desktop note below
3. `src/helpers/editor-detect.ts` — append to the `Promise.all` and the returned array
4. `src/commands/init.ts` — extend `EDITOR_DIRS`, `SIGNUP_EDITORS`, the `--editor` `.choices([...] as const)`, and `printManualInstructions`
5. `src/commands/plugin/install.ts` — extend `.choices([...] as const)` and add a case to `installForEditor` + the manual-instructions `catch`
6. `src/commands/plugin/url.ts` — extend `.choices([...] as const)` and branch before the URL ternary
7. Tests that assert the exact choice list: `tests/commands/plugin/install.test.ts`, `tests/commands/plugin/url.test.ts`, and `tests/helpers/editor-detect.test.ts` (length + id order)

User-scope editors (e.g., opencode) write to a path resolved in `paths.ts` rather than the project tree — `configureEditorSettings` returns that path for the init summary and the real work happens in `tryInstallPlugin`.

**Match the target editor's actual path resolution — don't assume Windows conventions.** opencode uses `xdg-basedir`, which falls back to `~/.config` on **all platforms** (Windows: `C:\Users\<user>\.config\…`, not `%APPDATA%\…`). `opencodeAgentsDir()` must mirror that exactly. Verify the editor's own path helper before writing a resolver for a new user-scope editor.

**opencode ships two distributions — CLI detection alone misses the Desktop app.** The Electron-based Desktop app (`@opencode-aidesktop` on Windows) ships **no CLI binary**, so `isOpencodeCliAvailable()` (PATH check) can't detect it. Both distributions share `opencodeConfigDir()` (`~/.config/opencode/`), so `isOpencodeAvailable()` in `plugin-install.ts` also treats that directory's existence as installed. All three call sites (`editor-detect.ts`, `init-project.ts`, `commands/plugin/install.ts`) use the broader `isOpencodeAvailable()` — use it for any new opencode-gated behavior too.
