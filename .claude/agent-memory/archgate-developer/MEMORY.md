# Agent Memory

Almost everything this project knows is enforced, not remembered: ADRs in `.archgate/adrs/`, their companion `.rules.ts`, the oxlint plugins in `lint/`, and the test suite all re-run on every `bun run validate`. Those mechanisms are the memory. What lives here is only what no check can reach.

**Before adding an entry, ask which layer should carry it instead** — static syntax → a custom oxlint rule; executable behaviour → a test; cross-file governance → an ADR companion `.rules.ts`; behaviour every archgate user shares → a built-in `CheckResult` diagnostic. Only what none of those can reach belongs here. Anything else written here is validated by nobody and goes stale silently.

## MANDATORY: Post-Coding Workflow

Every work loop ends with these three, even for trivial changes. The user should never have to ask:

1. **`bun run validate`** — the full gate (stages listed in CLAUDE.md)
2. **`@reviewer` skill** — `Skill` tool, `archgate:reviewer`
3. **`@lessons-learned` skill** — `Skill` tool, `archgate:lessons-learned`

Exceptions: minor follow-up tweaks after validation already passed, and non-code changes.

## Environment facts no rule can check

- **`archgate` is not on PATH here** — this IS the CLI repo. Use `bun run cli <command>`.
- **`archgate check` emits non-blocking diagnostics** alongside rule failures: `[suppression]`, `[briefing]`, and `[adr]` lines are advisories that never affect `pass`. Check which kind you have before treating a finding as a blocker.
- **Commit with `--signoff`** — the DCO check rejects commits without `Signed-off-by`.
- **This repo is PUBLIC** — no private sibling-repo internals, no Claude session links in PRs or commits.
- **Commit before fire-testing a rule or guard.** The loop (mutate → confirm the check fails → restore) restores with `git checkout <file>`, which discards all uncommitted work in that file, including the fix under test.
- **Fire-test a guard in BOTH directions** — that it blocks the bad case AND still permits the legitimate one. A green suite proves only that the gate closes, not that it isn't over-rejecting.
- **Verify a review agent's claim before acting on it.** They misquote both ADRs and the files they have just read; `grep` the exact quoted string first. A governance finding citing no ADR cannot block on governance grounds — but a demonstrated defect blocks on its own merits.
- **Content filtering blocks policy/legal boilerplate** — generating a Contributor Covenant or license text can trip API filtering. Ask the user to copy it from the official source.

## Topic files

- [Pick the right enforcement layer](feedback_prefer_tests_over_adr_rules.md) — syntax → lint rule; behaviour → test; governance → ADR rule; CLI behaviour → built-in
- [Answer every review finding on its own thread](feedback_reply_on_review_threads.md) — declines especially; a summary comment does not close the loop
- [Throw UserError in boundary-wrapped guards](feedback_throw_usererror_in_guards.md) — not `logError` + `exitWith(1)`
- [Docs are forward-only and version-independent](feedback_forward_only_docs.md) — no pinned versions or drift-prone counts; nothing enforces this
- [Claude Code hooks config](project_claude_code_hooks_config.md) — the `"shell": "bash"` requirement and the `WorktreeCreate` contract
- [PR review thread triage](project_pr_review_thread_triage.md) — REST hides resolution state; use the GraphQL `reviewThreads.isResolved` field
- [Rules engine follow-up](project_rules_engine_internals.md) — the one pending perf item no rule tracks
