# CLAUDE.md

Archgate is a CLI tool for AI governance via Architecture Decision Records (ADRs) — combining human-readable docs with machine-checkable rules. The CLI dogfoods itself via ADRs in `.archgate/adrs/`. AI features are delivered as a Claude Code plugin (`../plugins/claude-code`), not via direct API calls.

## Technology Stack

- **Runtime:** Bun — not Node.js compatible (minimum version enforced in `src/cli.ts`)
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
bun run validate              # MANDATORY: lint + typecheck + format:check + test + ADR check + knip + build check
bun run build:check            # verify build compiles (CI builds binaries via release workflow)
bun run commit                # conventional commit wizard
```

## Validation Gate

**`bun run validate` must pass before any task is considered complete.** Fail-fast pipeline: lint → typecheck → format:check → test → ADR check → knip → build check. Mirrors CI in `.github/workflows/code-pull-request.yml`.

## Git Hooks (Git 2.54+)

Config-based hooks in `.githooks` run validation locally before commits and pushes:

- **pre-commit:** lint + typecheck + format:check (~15s)
- **pre-push:** full `bun run validate` (~60s, mirrors CI)

Activate once per clone:

```bash
git config --local include.path ../.githooks
```

Opt out of a specific hook: `git config --local hook.<name>.enabled false`. Skip all hooks for a single commit: `git commit --no-verify`.

## Agent Memory

Claude Code sessions in this repo keep a small persistent memory at `.claude/agent-memory/archgate-developer/` (index: `MEMORY.md`).

It is deliberately small. Governance lives in ADRs, companion `.rules.ts`, the oxlint plugins in `lint/`, and the test suite — all re-validated on every `bun run validate`. Memory holds only what no check can reach: Claude Code harness behaviour, GitHub state, external-tool quirks, and the agent's own working process. Anything a rule could enforce belongs in the rule, which stays true; a memory entry is validated by nobody and rots silently.

Before adding an entry, ask which layer should carry it instead: a static syntax invariant belongs in a custom oxlint rule, executable behaviour in a test, cross-file governance in an ADR companion `.rules.ts`, and behaviour every archgate user shares in a built-in `CheckResult` diagnostic. Only when none of those can reach it does it belong here. Nothing here is required reading for contributors or tools without access to it.

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

## Distribution

Archgate ships as a compiled binary (`bun build --compile`) published to GitHub Releases, plus **thin shim** packages for each supported ecosystem — npm (`shims/npm/archgate.cjs`), PyPI, RubyGems, Maven, NuGet, and Go (all under `shims/`). A shim bundles no binary: on first run it detects the platform, downloads the matching binary from GitHub Releases, verifies its SHA256 checksum, caches it to `~/.archgate/bin/`, and forwards to it (see ARCH-017). Runtime dependencies (commander, inquirer, zod) are bundled into the compiled binary, so they belong in `devDependencies`, not `dependencies`.

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
8. To make the editor's transcripts readable, also extend `src/helpers/harness-detect.ts` (`DetectedHarness` union and the `SIGNALS` table), the `listFor`/`readFor` switches in `src/helpers/session-context-auto.ts`, and the `EDITORS` choice list in `src/commands/session-context.ts`

**A session reader must be verified against a live session of the editor, not against fixtures.** Every harness records a turn where the agent only issued tool calls as a message whose prose content is empty; a reader that maps events to transcript entries without checking emits it as a blank entry. Skip a turn whose content preview is empty after trimming. The same class of gap hides in event shapes: one editor's CLI and desktop distribution can write the same conversation in different shapes, and a reader taught only one of them returns zero turns for the other. Fixtures agree with whatever the reader already assumes, so neither is visible until a real transcript is read.

**Two detections answer different questions — keep them apart.** `editor-detect.ts` asks whether an editor is _installed_, so a config directory or a binary on PATH is proof. `harness-detect.ts` asks which editor is _running this process_, where only a variable the editor injects into its subprocesses counts; an installed-but-idle editor must never register there. Reaching for `copilotConfigDir()` or a PATH probe in the runtime path would make every user of that editor look like they are inside it.

User-scope editors (e.g., opencode) write to a path resolved in `paths.ts` rather than the project tree — `configureEditorSettings` returns that path for the init summary and the real work happens in `tryInstallPlugin`.

**Match the target editor's actual path resolution — don't assume Windows conventions.** opencode uses `xdg-basedir`, which falls back to `~/.config` on **all platforms** (Windows: `C:\Users\<user>\.config\…`, not `%APPDATA%\…`). `opencodeAgentsDir()` must mirror that exactly. Verify the editor's own path helper before writing a resolver for a new user-scope editor.

**opencode ships two distributions — CLI detection alone misses the Desktop app.** The Electron-based Desktop app (`@opencode-aidesktop` on Windows) ships **no CLI binary**, so `isOpencodeCliAvailable()` (PATH check) can't detect it. Both distributions share `opencodeConfigDir()` (`~/.config/opencode/`), so `isOpencodeAvailable()` in `plugin-install.ts` also treats that directory's existence as installed. All three call sites (`editor-detect.ts`, `init-project.ts`, `commands/plugin/install.ts`) use the broader `isOpencodeAvailable()` — use it for any new opencode-gated behavior too.

**GitHub Copilot has the same two-distribution shape — and a declarative install path.** The Copilot desktop app ships no CLI binary but shares `copilotConfigDir()` (`~/.copilot/`) with the `copilot` CLI, so copilot-gated behavior must use `isCopilotAvailable()` (PATH check OR config dir exists), never `isCopilotCliAvailable()` alone. The plugin install is declarative-first: `installCopilotPlugin()` always writes the marketplace + plugin declaration into `~/.copilot/settings.json` (`extraKnownMarketplaces` + `enabledPlugins` — Copilot's marketplace registry and auto-install list, read by both distributions on startup; an existing `archgate` entry is overwritten to correct stale URLs), then additionally runs `copilot plugin install archgate@archgate` when the CLI is on PATH. `mode: "declarative"` in the result means the user must restart the Copilot app for the install to take effect. The settings merge lives in `copilot-user-settings.ts` (user-scope); `copilot-settings.ts` is project-scope (`.github/copilot/`).
