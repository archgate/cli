# Agent Memory

## MANDATORY: Post-Coding Workflow (DO NOT SKIP)

Every work loop MUST end with these three steps, even for trivial changes. The user should never have to ask for them:

1. **`bun run validate`** — the full gate (see CLAUDE.md for the stage list)
2. **`@reviewer` skill** — `Skill` tool, `archgate:reviewer`. Structural ADR compliance beyond automated rules.
3. **`@lessons-learned` skill** — `Skill` tool, `archgate:lessons-learned`. Captures learnings and governance gaps.

Two exceptions to steps 2–3: minor follow-up tweaks after validation already passed, and non-code changes.

## Repo Facts Not Derivable From CLAUDE.md

- **`archgate` is not on PATH here** — this IS the CLI repo. Use `bun run cli <command>`.
- **ADR rule violations are hard blockers, but `archgate check` also emits non-blocking diagnostics** — `[suppression]` and `[briefing]` lines are built-in advisories, not rule failures, and never affect `pass`. Check what kind of finding you have before treating it as a merge blocker.
- **Pre-1.0 breaking changes bump MINOR, not major** (`.simple-release.js` cap); v1.0.0 needs an explicit forced bump.
- **The npm shim must keep its `.cjs` extension** — root `package.json` is `"type": "module"`, so a `.js` shim parses as ESM and fails.
- **Content filtering blocks policy/legal boilerplate** — generating a Contributor Covenant or license text can trip API filtering. Ask the user to copy it from the official source.

## Approach Guidance

- [Always commit with --signoff](feedback_git_signoff.md) — DCO CI rejects commits without `Signed-off-by`
- [No prod changes for testability](feedback_no_prod_changes_for_tests.md) — mock in tests; never bend prod semantics for isolation
- [Pick the right enforcement layer](feedback_prefer_tests_over_adr_rules.md) — syntax → oxlint rule; behavior → tests; governance → ADR rules; `rules: false` is valid
- [This repo is PUBLIC](feedback_public_repo_privacy.md) — no private sibling-repo internals, no Claude session links in PRs or commits
- [Keep comments and memory entries concise](feedback_concise_comments.md) — code side is machine-enforced by GEN-004; memory conciseness is manual
- [Answer every review finding on its own thread](feedback_reply_on_review_threads.md) — especially declined ones; a summary comment does not close the loop
- [Throw UserError in boundary-wrapped guards](feedback_throw_usererror_in_guards.md) — not `logError` + `exitWith(1)`
- [Docs are forward-only and version-independent](feedback_forward_only_docs.md) — no "previously"; no pinned versions or drift-prone counts

## Patterns & Fixes

Environment, CI, and platform quirks no static rule catches. Machine-checked conventions live in their ADRs instead.

- [Rules engine and AST internals](project_rules_engine_internals.md) — glob semantics, scanner/transpiler traps, per-run caches, rule authoring, reviewer verification
- [ADR corpus maintenance](project_adr_corpus_maintenance.md) — the briefing budget, what's machine-load-bearing in an ADR, and why not to fabricate Consequences
- [Stale context vs disk](project_stale_context_vs_disk.md) — the CLAUDE.md snapshot and a squash-merged branch both lie; verify against disk and `origin/main`
- [oxlint rule gotchas](project_oxlint_gotchas.md) — custom `jsPlugins` convention and the rules that misfire on this codebase
- [Test isolation gotchas](project_test_isolation_gotchas.md) — `mock.module` leaks process-wide, env vars leak across files, Windows/macOS flakiness
- [Windows subprocess/path gotchas](project_windows_subprocess_gotchas.md) — Git Bash `/tmp` invisible to native tools, YAML escaping, binary-upgrade cleanup
- [CI workflow gotchas](project_ci_workflow_gotchas.md) — `GITHUB_TOKEN` pushes don't trigger workflows, `secrets` vs `vars`, jq CRLF on Windows
- [Release pipeline gotchas](project_release_pipeline_gotchas.md) — workflow-trigger race, toolchain cache bug, stdout pollution, publish-go-tag permissions
- [Shim publishing gotchas](project_shim_publishing.md) — per-ecosystem packaging traps and advertised-vs-installable version lag
- [session-context `--skip 1` inline-skill bug](project_session_context_skip_root_fix.md) — the `--root` fix, plus how to inspect `opencode.db`
- [CLI-skill flag sequencing](project_cli_skill_flag_sequencing.md) — ship the CLI first when adding a flag, the plugin promptly when removing one
- [PR review thread triage](project_pr_review_thread_triage.md) — REST hides resolved state; use the GraphQL `reviewThreads.isResolved` field
- [CLI startup baselines](project_cli_perf_baselines.md) — the numbers behind the perf budgets, and how to spot a real regression

## Claude Code Harness Config

- [Hooks config](project_claude_code_hooks_config.md) — the `WorktreeCreate` stdin/stdout contract and the `"shell": "bash"` requirement
- [WorktreeCreate hook bug history](project_worktree_create_hook_contract.md) — 5 fixes worth re-testing if that hook changes
- [Cursor Approval Agent is external](reference_cursor_approval_agent.md) — it lives on cursor.com; no policy files for it exist in this repo

## Translation Quality

- [i18n translation checks](project_i18n_translation_quality.md) — nb + pt-br parity, and the Norwegian corruption patterns to scan for
