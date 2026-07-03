# Agent Memory

## MANDATORY: Post-Coding Workflow (DO NOT SKIP)

Every work loop MUST end with these steps — no exceptions, even for trivial changes:

1. **`bun run validate`** — lint, typecheck, format, test, ADR check, knip, build check (fail-fast)
2. **`@reviewer` skill** — Invoke via `Skill tool` with skill `"archgate:reviewer"`. Validates structural ADR compliance beyond automated rules.
3. **`@lessons-learned` skill** — Invoke via `Skill tool` with skill `"archgate:lessons-learned"`. Captures learnings and governance gaps.

Skipping steps 2 or 3 is a workflow violation. The user should NEVER have to invoke these manually.

## Version References

- **Minimum version** (`>=1.2.21`) in `src/cli.ts`/CLAUDE.md "Technology Stack" is the user-facing floor; **pinned version** (`1.3.14`) in `.prototools`/CLAUDE.md "Toolchain" is the dev toolchain version — these are intentionally different. Pre-1.0 breaking changes bump MINOR, not major (`.simple-release.js` cap); v1.0.0 requires an explicit forced bump.

## Git Workflow

- [Always commit with --signoff](feedback_git_signoff.md) — DCO CI check rejects commits without `Signed-off-by`

## Approach Guidance

- [No prod changes for testability](feedback_no_prod_changes_for_tests.md) — mock in tests (e.g. spyOn), never alter prod semantics for test isolation
- [Pick the right enforcement layer](feedback_prefer_tests_over_adr_rules.md) — static syntax → custom oxlint rule; executable behavior → tests; cross-file/governance → ADR `.rules.ts`
- [This repo is PUBLIC — no private sibling-repo internals in memory/PRs](feedback_public_repo_privacy.md)
- [Keep code comments and memory entries concise](feedback_concise_comments.md) — one line + terse why, link out for detail

## Known Bugs

- _(none currently)_

## Platform Limitations

- **Content filtering on policy/legal text** — Auto-generating Contributor Covenant/license boilerplate (e.g. `CODE_OF_CONDUCT.md`) can trigger API content filtering. Tell the user to copy it manually from the official source instead.

## Patterns & Fixes

Non-enforceable lessons — environment/CI/platform quirks no static rule can reliably catch. (Conventions that ARE machine-checked live in their ADRs under `.archgate/adrs/`, so they're not duplicated here.)

- [oxlint rule gotchas + custom jsPlugins convention](project_oxlint_gotchas.md) — expect-expect plugin, array-callback-reference, unicode-regexp, prefer-regexp-test, no-negated-condition, catch-param, no-await-in-loop, ARCH-020 comment trigger, oxfmt-on-markdown
- [Test isolation gotchas](project_test_isolation_gotchas.md) — mock.module process-global leakage, Bun.env leaking across test files, Windows git-credential/GCM isolation, bun:sqlite EBUSY, macOS /var symlink, don't test PATH tools
- [Windows subprocess/path gotchas](project_windows_subprocess_gotchas.md) — Git Bash /tmp invisible to native tools, YAML backslash escaping, binary-upgrade `.old` cleanup, module-level `Bun.env` spread capture
- [CI workflow gotchas](project_ci_workflow_gotchas.md) — GITHUB_TOKEN pushes don't trigger workflows, secrets vs vars namespaces, jq CRLF on Windows Git Bash
- [Rules engine / command internals](project_rules_engine_internals.md) — Bun.Glob brace-pattern scan bug, commander option hoisting, cross-command I/O sharing pattern, verifying reviewer sub-agent ADR citations
- [session-context --skip 1 inline-skill bug](project_session_context_skip_root_fix.md) — opencode fixed via top-level default + `--root`; other editors fixed with plain command; includes opencode.db inspection technique
- [CLI-skill flag sequencing across releases](project_cli_skill_flag_sequencing.md) — ship CLI first for flag additions, ship plugin promptly after for removals
- [Release pipeline gotchas](project_release_pipeline_gotchas.md) — workflow-trigger race, moonrepo/setup-toolchain cache bug, update-check stdout pollution, publish-go-tag permissions

## Claude Code Harness Config

- [Hooks config (`.claude/settings.json`)](project_claude_code_hooks_config.md) — WorktreeCreate contract (stdin JSON in, path-only stdout out) + the `"shell": "bash"` requirement for POSIX hooks
- [WorktreeCreate hook bug history](project_worktree_create_hook_contract.md) — 5 rounds of fixes, re-test all of them if this hook changes
- [Cursor Approval Agent is external, not in-repo](reference_cursor_approval_agent.md) — "Archgate CLI Approver" automation lives on cursor.com; no APPROVAL_POLICY.md/ROUTING.md exist in this repo

## Translation Quality

- [i18n translation quality checks](project_i18n_translation_quality.md) — nb/ + pt-br/ dual-locale requirement, Norwegian diacritical corruption patterns to scan for

## Validation Pipeline

- `bun run validate` is the mandatory gate: lint → typecheck → format:check → test → ADR check → knip → build:check
- All ADR rule severities are `error` (not `warning`) — violations are hard blockers
- The pipeline is fail-fast — fix failures in order

## CLI Repo Quirk

- **`archgate` command = `bun run cli`** — This is the CLI repo itself, so the `archgate` binary is not installed in PATH. Use `bun run cli <command>` instead of `archgate <command>`.

## Distribution / Packaging

- **npm shim + GitHub Releases** — The npm package is a thin shim (`bin/archgate.cjs`) that downloads the platform binary on first run and caches it to `~/.archgate/bin/`.
- **`.cjs` extension is mandatory** for any root-level Node.js CJS wrapper — root `package.json` has `"type": "module"`, so `.js` gets parsed as ESM and fails.
- [Shim publishing pipeline gotchas](project_shim_publishing.md) — PyPI README, RubyGem Rakefile/working-dir, Maven waitUntil, advertised-vs-installable version lag, Go module registration on pkg.go.dev
