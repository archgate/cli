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
- **A review agent's verdict on non-English prose is worthless**, and it invents the detail that supports it: an orthography pass over the pt-br docs returned PASS while asserting accents the words do not contain (`depreciadas` "(á)", `governança` "(ã)"). Grep cannot settle a claim about meaning, so verify mechanically instead — does the stripped form still occur, did fenced code blocks change — and leave the language judgement to a human speaker.
- **Reproduce a described failure before scheduling work from it** — including when your own scan reports zero. Of three issues one audit derived from memory files, two collapsed to nothing once the failure was actually tested (#517 Go proxy, #518 branch protection); the third was real but larger than described (#516). And prove a zero is a real zero: `\b` inside a JS template literal is a backspace, not a word boundary, so a regex built that way found no corruption where 69 occurrences sat.
- **Content filtering blocks policy/legal boilerplate** — generating a Contributor Covenant or license text can trip API filtering. Ask the user to copy it from the official source.
- **Files written under `/tmp` by this agent's own Bash/Write calls can vanish between tool calls** — observed for several scratch files with no deleting command run. Write anything that must survive several calls to a real Windows path instead (e.g. `C:/Users/<user>/AppData/Local/Temp/<task-name>/`); Bun/Node on Windows don't resolve Git-Bash-style `/c/Users/...` paths.
- **`archgate review-context`'s `--base` (auto-detect or explicit `origin/main`) diffs against the local `main`/`origin/main` ref, which can be stale-but-tree-identical after a squash merge** — same content, different commit hash, so it inflates `allChangedFiles` with every file from the last merged PR. Before trusting its output, `git fetch origin main:main`; if `git diff origin/main HEAD --stat` is empty the trees already match and `git reset origin/main` (never `--hard`) safely realigns the branch pointer without touching uncommitted work.
- **The tsconfig `composite: true` project only lists `src/`, `tests/`, `lint/` in `include`** — `.archgate/lint/`, `scripts/`, and `shims/` also hold `.ts` source (per GEN-004's `files` globs) but aren't part of the tsc program. Importing from an unlisted dir (e.g. a test unit-testing an oxlint plugin) fails with TS6307, not silent transitive inclusion. Add the dir to `include` if ever needed, but expect it may surface pre-existing type errors never checked before.
- **`review-context` omits every ADR's `decision`/`dosAndDonts` prose by default** — the `@reviewer` skill's own instructions describe the briefing as containing "only the Decision and Do's and Don'ts sections," but the CLI's actual default (confirmed via `--help`) leaves both fields off; only `--verbose` includes them. Without it, per-domain sub-agent prompts built from the response carry `id`/`title`/`domain` and nothing to actually check code against. Always run `bun run cli review-context --verbose` (per-domain, via `--domain <name>`, to keep each call small) when gathering context for the reviewer's sub-agent prompts.

## Topic files

- [Verify agents on TS changes must typecheck](feedback_verify_agents_run_typecheck.md) — `bun test`+lint+format missed a `noUnusedParameters` error a subagent self-reported as clean
- [Pick the right enforcement layer](feedback_prefer_tests_over_adr_rules.md) — syntax → lint rule; behaviour → test; governance → ADR rule; CLI behaviour → built-in
- [Answer every review finding on its own thread](feedback_reply_on_review_threads.md) — declines especially; a summary comment does not close the loop
- [Throw UserError in boundary-wrapped guards](feedback_throw_usererror_in_guards.md) — not `logError` + `exitWith(1)`
- [Docs are forward-only and version-independent](feedback_forward_only_docs.md) — no pinned versions or drift-prone counts; nothing enforces this
- [Claude Code hooks config](project_claude_code_hooks_config.md) — `"shell": "bash"`, `WorktreeCreate` contract, cloud env `SessionStart` bun-install workaround
- [PR review thread triage](project_pr_review_thread_triage.md) — REST hides resolution state; use the GraphQL `reviewThreads.isResolved` field
- [Rules engine follow-up](project_rules_engine_internals.md) — the one pending perf item no rule tracks
- [Parallel agents share one git index](feedback_parallel_agents_shared_worktree.md) — a stray stash/rebase from any one agent wipes every other agent's uncommitted work
- [Validate from a fresh clone before pushing](feedback_validate_from_fresh_clone.md) — a long-lived working dir masks generated-file ordering bugs CI will hit immediately
