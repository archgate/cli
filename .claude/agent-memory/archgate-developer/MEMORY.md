# Agent Memory

## MANDATORY: Post-Coding Workflow (DO NOT SKIP)

Every work loop MUST end with these steps — no exceptions, even for trivial changes:

1. **`bun run validate`** — lint, typecheck, format, test, ADR check (fail-fast)
2. **`@architect` skill** — Invoke via `Skill tool` with skill `"archgate:architect"`. Validates structural ADR compliance beyond automated rules.
3. **`@quality-manager` skill** — Invoke via `Skill tool` with skill `"archgate:quality-manager"`. Captures learnings and governance gaps.

Skipping steps 2 or 3 is a workflow violation. The user should NEVER have to invoke these manually.

## Version References

- **Minimum version** (`>=1.2.21`): Enforced in `src/cli.ts`, documented in CLAUDE.md "Technology Stack". This is the user-facing requirement.
- **Pinned version** (`1.3.8`): Set in `.prototools`, referenced in ADR risk sections (ARCH-005, ARCH-006) and CLAUDE.md "Toolchain" section. This is the dev toolchain version.
- These are intentionally different. When upgrading the pinned version, update `.prototools` + ADR risk sections + CLAUDE.md toolchain. Do NOT change the minimum unless a new Bun API is required.

## Known Bugs

- _(none currently)_

## Platform Limitations

- **Content filtering on policy/legal text** — Writing files containing Contributor Covenant, license text, or similar legal boilerplate (e.g., `CODE_OF_CONDUCT.md`) may trigger API content filtering and block output. Do NOT attempt to auto-generate these files. Instead, tell the user to copy the content manually from the official source (e.g., https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

## Patterns & Fixes

- **`git commit` in temp repos requires local identity** — CI runners have no global `user.email`/`user.name` configured. Any test that runs `git commit` on a temp repo MUST call `git config user.email` and `git config user.name` locally after `git init`. Fails with a cryptic `ShellPromise` error in CI; passes locally. Also captured in ARCH-005 Do's.
- **Never use `bunx prettier` directly** — Always use `bun run format` (to fix) or `bun run format:check` (to verify). Using `bunx prettier` can fail or use a different version than the project's devDependency. The same applies to all dev tools: prefer `bun run <script>` over `bunx <tool>` when a package.json script exists.
- **`Bun.Glob.match()` triggers oxlint `prefer-regexp-test`** — `Bun.Glob.match()` returns a boolean (not a RegExp), but oxlint can't tell. Suppress with `// oxlint-disable-next-line prefer-regexp-test -- Bun.Glob.match() returns boolean, not RegExp`.
- **oxlint `no-negated-condition`** — Always write ternaries with the positive condition first: `x === null ? A : B` not `x !== null ? B : A`. Applies to both `if/else` blocks and ternary expressions.
- **oxlint `no-unused-vars` on catch parameters** — Use bare `catch { }` (no parameter) when the caught error is not used. `catch (err) { }` with unused `err` triggers the rule.
- **oxlint `no-await-in-loop`** — Sequential `await` inside a `for` loop is flagged (warning). When the sequential order is intentional (e.g., build steps with per-step output), suppress with `// oxlint-disable-next-line no-await-in-loop -- <reason>`.
- **`bun build --compile --bytecode` rejects top-level `await`** — Even though `bun run` and `tsc` handle top-level `await` fine, the Bun bytecode compiler (`--bytecode`) does not. In `src/cli.ts`, all async bootstrap logic MUST be wrapped in `async function main() { ... }` and called as `main().catch((err) => { logError(String(err)); process.exit(2); })`. Never use top-level `await` in the CLI entry point. See ARCH-001 Do's for the documented pattern.
- **npm `main` field always gets included in publish** — `"main"` in `package.json` is always included in `npm publish` regardless of the `files` array. If the package doesn't need a default entry point (only sub-path exports like `./rules`), remove `main` entirely to avoid bundling the CLI entry point into the npm package.
- **`CHANGELOG.md` is auto-generated — exclude from Prettier** — `CHANGELOG.md` is written by `TrigenSoftware/simple-release-action` during the release PR workflow. It is committed directly and never formatted by Prettier. It MUST be in `.prettierignore`; otherwise `bun run format:check` (part of `bun run validate`) will fail on the release PR. Do not attempt to run prettier on it post-commit.
- **`mock.module("node:fetch", ...)` does NOT intercept `globalThis.fetch` in Bun** — Bun's runtime fetch is `globalThis.fetch`, not the `node:fetch` module. Using `mock.module` silently fails; the real network is hit. Always mock fetch by assigning `globalThis.fetch = mockFn as unknown as typeof fetch` directly, and restore via `mock.restore()` in `afterEach`. TypeScript type cast: `as never` is insufficient for the `typeof fetch` type (which includes `preconnect`) — always use `as unknown as typeof fetch`. Also captured in ARCH-005 Don'ts.
- **Git credential tests need system-level isolation on Windows** — Overriding `Bun.env.HOME` is NOT sufficient to isolate `git credential fill/approve` calls in tests. Windows Credential Manager is a system-level API, not file-based. Tests MUST set `Bun.env.GIT_CONFIG_NOSYSTEM = "1"` and `Bun.env.GIT_CONFIG_GLOBAL = <path-to-empty-file>` to prevent git from reading the real credential helper config. Without this, tests on machines with stored credentials will pick up real tokens.
- **GCM prompt suppression requires 5 env vars** — `GIT_TERMINAL_PROMPT=0` alone does NOT prevent Git Credential Manager (GCM) from showing GUI prompts on Windows or askpass prompts on Linux. The full set for `gitCredentialEnv()` in `src/helpers/credential-store.ts` is: `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, `GCM_GUI_PROMPT=false`, `GIT_ASKPASS=""`, `SSH_ASKPASS=""`. Omitting any one can trigger unexpected prompts in editor contexts where the CLI runs as a subprocess.
- **Module-level `{ ...Bun.env }` captures env at import time** — Spreading `Bun.env` into a module-level constant freezes the env snapshot. Tests that override `Bun.env.HOME` after import won't affect the constant. Fix: use a function that returns `{ ...Bun.env, ... }` on each call so it picks up test-time overrides. Applied in `src/helpers/credential-store.ts`.
- **`Bun.Glob.scan({ dot: false })` silently drops dot-prefixed segments — even on explicit paths** — `dot: false` (the default) skips matches whose path contains a `.`-prefixed segment, including patterns that explicitly name the dir (e.g. `.github/workflows/release.yml`). Behavior also varies across platforms — Windows reliably drops the match while Linux can match the same pattern, so a rule appears to "work in CI" but no-ops locally. For code repos where `.github/`, `.husky/`, `.vscode/` are first-class source dirs, ALWAYS pass `dot: true` to `Bun.Glob.scan()`. Applied in `src/engine/runner.ts` (`ctx.glob`, `ctx.grepFiles`) and `src/engine/git-files.ts` (`resolveScopedFiles`). See archgate/cli#222.

## Validation Pipeline

- `bun run validate` is the mandatory gate: lint → typecheck → format:check → test → ADR check → build:check
- All ADR rule severities are `error` (not `warning`) — violations are hard blockers
- The pipeline is fail-fast — fix failures in order

## CLI Repo Quirk

- **`archgate` command = `bun run cli`** — This is the CLI repo itself, so the `archgate` binary is not installed in PATH. Use `bun run cli <command>` (e.g., `bun run cli check`, `bun run cli adr list`) instead of `archgate <command>`. The `bun run cli` script maps to `bun run src/cli.ts`.

## Distribution / Packaging

- **npm shim + GitHub Releases** — The npm package is a thin shim (`bin/archgate.cjs` + `scripts/postinstall.cjs`). On first run, the shim downloads the platform binary from GitHub Releases and caches it to `~/.archgate/bin/`. No platform-specific npm packages.
- **`.cjs` extension is mandatory** — Root `package.json` has `"type": "module"`. Any Node.js CJS wrapper script placed at the package root MUST use `.cjs`, not `.js`, or Node.js will attempt to parse it as ESM and fail.

## Telemetry Strategy

- [Telemetry & Analytics Strategy](project_telemetry_strategy.md) — Decisions on PostHog analytics, Sentry error tracking, plugin surveys (2026-03-22)
