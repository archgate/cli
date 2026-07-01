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

These are two distinct, non-overlapping namespaces in workflow expressions — configuring a value as a repo **secret** does NOT make it readable via `vars.*`, and vice versa. `.github/workflows/release.yml`'s "Annotate release in PostHog" step read `POSTHOG_PROJECT_ID` via `${{ vars.POSTHOG_PROJECT_ID }}` while the value only ever existed as a **secret** (`gh secret list`), so `vars.POSTHOG_PROJECT_ID` always resolved empty. Combined with a guard clause that does `exit 0` (not a failure) when required config is missing, plus `continue-on-error: true` and a low-visibility `::notice::` log line, the step silently no-opped on every release for weeks — annotations simply stopped appearing in PostHog with no CI failure to flag it. Fixed by reading `secrets.POSTHOG_PROJECT_ID` to match where the value actually lives.

When adding any workflow step that reads repo-level config: confirm the value's actual location with `gh secret list` / `gh variable list` before writing `secrets.X` vs `vars.X`, and if the step is `continue-on-error: true` with an internal "not configured, skipping" guard, use `::warning::` (or higher) rather than `::notice::` so a misconfiguration is visible in the Actions UI instead of silently invisible indefinitely.

## Claude Code Harness Config (`.claude/settings.json`)

The `hooks.WorktreeCreate` entry is **not** a post-creation setup step — once it's configured, the Claude Code harness defers the _entire_ worktree creation to it (it does not also create a git worktree on its own). The hook receives a JSON payload on stdin (`{ "cwd", "name", ... }`, same pattern as the `PostToolUse` hook reading `.tool_input.file_path` via `jq`) and **must** create the worktree itself and echo _only_ the resulting absolute path as its final stdout line — any other stdout (e.g. unsilenced `bun install` or `git worktree add` output) gets misread as the path and breaks `EnterWorktree`/`ExitWorktree` with errors like `path contains control characters` or `ENOENT: ... chdir`. Redirect all setup-command output to stderr (`>&2`) and keep the trailing `printf` as the only real stdout. Do not simplify this hook back down to a bare `bun install` — that regression is exactly what caused the worktree-creation bug fixed here.

**Command-type hooks with POSIX shell syntax MUST set `"shell": "bash"` explicitly — do not rely on the platform default, even on Windows with Git Bash installed.** Without it, on at least one confirmed Windows setup, the hook runner fell back to spawning via `cmd.exe` (Node `child_process.spawn` with `shell: true` defaults to `%ComSpec%`) instead of detecting Git Bash — even though the interactive `Bash` tool on the same machine correctly used Git Bash. Symptom: `<hook> failed: <command text>: 'x' is not recognized as an internal or external command, operable program or batch file.` (that exact phrasing is cmd.exe's, not PowerShell's — PowerShell says `is not recognized as the name of a cmdlet, function, script file, or operable program`). Fix: add `"shell": "bash"` to the hook object (sibling of `"command"`). If Git Bash still isn't found (error becomes `Hook "..." requires bash but Git Bash was not found`), Claude Code checks, in order: the `CLAUDE_CODE_GIT_BASH_PATH` env var, then `C:\Program Files\Git\bin\bash.exe` / the `(x86)` variant, then a `git` on `PATH` resolved to `..\..\bin\bash.exe` — set `CLAUDE_CODE_GIT_BASH_PATH` if none of those apply. Verified end-to-end via `EnterWorktree`/`ExitWorktree` on `hooks.WorktreeCreate` on 2026-07-01.

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

**Match the target editor's actual path resolution — don't assume Windows conventions.** opencode uses the `xdg-basedir` npm package, which falls back to `~/.config` on **all platforms** (including Windows, where it resolves to `C:\Users\<user>\.config\…`, not `%APPDATA%\…`). `opencodeAgentsDir()` must mirror that exact logic or the CLI writes files the editor can't find. When adding a user-scope editor, verify the editor's path helper in its source before writing the resolver.

**opencode ships two distributions — CLI detection alone misses the Desktop app.** The `opencode` CLI is one distribution; the opencode Desktop app (Electron-based, e.g. `@opencode-aidesktop` on Windows) is another, and it ships **no CLI binary at all** — `isOpencodeCliAvailable()` (a PATH check via `resolveCommand`) can never detect it. Both distributions read/write the same `opencodeConfigDir()` (`~/.config/opencode/`), so `isOpencodeAvailable()` in `plugin-install.ts` also treats that directory's existence as a valid installed-opencode signal. All three call sites (`editor-detect.ts`, `init-project.ts`, `commands/plugin/install.ts`) use `isOpencodeAvailable()`, not the narrower CLI-only check — use the broader one for any new opencode-gated behavior too.
