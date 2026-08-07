# Agent Memory

Almost everything this project knows is enforced, not remembered: ADRs in `.archgate/adrs/`, their companion `.rules.ts`, the oxlint plugins in `lint/`, and the test suite all re-run on every `bun run validate`. Those mechanisms are the memory. What lives here is only what no check can reach.

**Before adding an entry, ask which layer should carry it instead** — static syntax → a custom oxlint rule; executable behaviour → a test; cross-file governance → an ADR companion `.rules.ts`; behaviour every archgate user shares → a built-in `CheckResult` diagnostic. Only what none of those can reach belongs here. Anything else written here is validated by nobody and goes stale silently.

**Keep this file an index.** One line per entry; detail belongs in a topic file.

## MANDATORY: Post-Coding Workflow

Every work loop ends with these three, even for trivial changes. The user should never have to ask:

1. **`bun run validate`** — the full gate (stages listed in CLAUDE.md)
2. **`@reviewer` skill** — `Skill` tool, `archgate:reviewer`
3. **`@lessons-learned` skill** — `Skill` tool, `archgate:lessons-learned`

Exceptions: minor follow-up tweaks after validation already passed, and non-code changes.

## Environment facts no rule can check

- **`archgate` is not on PATH here** — this IS the CLI repo. Use `bun run cli <command>`.
- **This repo sets `strict: true`** in `.archgate/config.json`, so the `[suppression]`, `[briefing]`, and `[adr]` advisories block `check`, `review-context`, and `adr sync` alike, with no flag passed (ARCH-026). The practical bite: an over-budget ADR section fails the build rather than warning it — see [[adr-briefing-budget]].
- **Commit with `--signoff`** — the DCO check rejects commits without `Signed-off-by`.
- **This repo is PUBLIC** — no private sibling-repo internals, no Claude session links in PRs or commits.
- **Commit before fire-testing a rule or guard.** The loop (mutate → confirm the check fails → restore) restores with `git checkout <file>`, which discards all uncommitted work in that file, including the fix under test.
- **Fire-test with `ARCHGATE_TELEMETRY=0` whenever the guard under test throws.** A local `bun run cli` run reports `environment: production` to Sentry, so a guard reaching the exit-2 boundary files a real issue against the product from a deliberately broken tree. A guard reporting an ADR violation is safe; one that throws is not.
- **Fire-test a guard in BOTH directions** — that it blocks the bad case AND still permits the legitimate one. A green suite proves only that the gate closes, not that it isn't over-rejecting. Fire-testing also exposes branches that can never fire: when an earlier pipeline stage aborts on the same condition, the later branch is dead governance (`check` regenerates `rules.d.ts` before any rule runs, so a throw from `generateRulesDts()` preempts any rule testing the same thing). Delete the unreachable branch and name the real enforcement point.
- **Confirm a probe or fire-test fixture holds the bytes you meant before believing the result.** A `bun -e` body inside shell single quotes is still parsed as a JS string literal, so an escape written for the file collapses one level on the way in and the injected "violation" lands as ordinary well-formed text — a false negative that looks like a defect in the rule. A quoted `<<'EOF'` heredoc through the Bash tool is not reliably literal either: a backslash-heavy regex probe run that way reported no match for a pattern that matches fine. Write any escape-sensitive probe to a real file with the Write tool instead of inlining it in a shell command, build such fixtures from `String.fromCodePoint` (oxlint's `unicorn/prefer-code-point` rejects `fromCharCode`), and print the file back (`cat -A`) first.
- **A Sentry issue whose `install_path` is a local worktree is an artifact of that worktree, not a user report.** Confirm provenance from `install_path`, `is_ci`, and the timestamp — then still ask whether the error was classified correctly, because reaching Sentry at all claims archgate has a bug rather than the caller.
- **`--update-snapshots` is never on its own the fix for a failing snapshot.** `tests/helpers/__snapshots__/rules-shim.test.ts.snap` is the entire `rules.d.ts` a governed project receives, and its diff is the review artifact — read every hunk and confirm it follows from an intended `src/formats/rules.ts` edit before regenerating. Deleting the file routes around nothing: Bun fails a missing snapshot whenever `CI` is set, and passes it locally.
- **`actionlint` silently skips its shellcheck-backed checks when `shellcheck` is not on PATH.** A Windows dev machine typically has none, so a local run exits 0 while CI (ubuntu-latest) fails on a `run:` block — SC2086 on an unquoted variable is the common one. A Git Bash `PATH` entry must use the Unix-style form (`/c/Users/...`), or the lookup silently fails.
- **Splitting a test file for `oxlint`'s 500-line `max-lines` cap: add a sibling `<name>-<suffix>.test.ts`, don't trim coverage.** Precedent: `check-max-warnings.test.ts` beside `check.test.ts`; followed again for `reporter-strict.test.ts`, `sync-strict.test.ts`, and the `*-strict.test.ts` integration files.
- **`typescript/no-unnecessary-condition` does not flag a string-literal union compared against a literal outside it.** With `typeAware: true`, a narrowed `"a" | "b"` tested against `""` passes clean while a `string !== undefined` control in the same function is flagged at once. Narrowing a type does not hand the dead comparison to the linter, so a clean lint run is not evidence either way.
- **Sizing a change's blast radius by grep: search each token separately, don't require them on one line.** A pattern requiring `"check"` and `"--json"` on the same line missed `tests/commands/check.test.ts`, where they sit on adjacent lines — surfacing only when `bun run validate` failed after a "complete" migration.
- **A `test.skipIf(process.platform === "win32")` test passes vacuously on this machine — run it under WSL before believing it.** A skipped test reports as passing, so an assertion that never executes reads exactly like a verified one. Bun installs in WSL Ubuntu via `curl -fsSL https://bun.sh/install | bash`, then `wsl.exe -d Ubuntu -- bash -lc 'cd /mnt/e/... && ~/.bun/bin/bun test <files>'` runs the Linux-only cases against the Windows checkout. Fire-test there too — a skipped fire-test proves nothing.
- **Run WSL against every test file a change touches, not just the one being written.** Compare the Windows and Linux `skip` counts: a change to a helper's signature broke three `tests/commands/upgrade-action.test.ts` cases that Windows skips, and checking only the helper's own test file missed them until CI. Two caveats: `/mnt/e` fails ~120 subprocess-integration tests (`review-context`, `stream-guards`, `session-context` spawn the CLI) that pass on real CI Linux, so a full-suite WSL run cannot be read as a gate — target the affected files and judge failures by whether they touch your change; and coverage from `/mnt/e` runs is not comparable to CI's.
- **Genuine OS-level EPIPE cannot be arranged from bun:test on Windows** — a spawned child's `stdout.cancel()` leaves the child's pipe open, and Git-Bash `cmd | true` pipelines may never break the pipe even unguarded (so a passing fire-test there is inconclusive, not proof). Synthesize `process.stdout.emit("error", err)` with `code: "EPIPE"` instead, as in `tests/integration/stream-guards.test.ts`. A real break IS reproducible locally with a sustained writer piped to `head -c 100`.
- **`archgate review-context`'s `--base` diffs against the local `main`/`origin/main` ref, which can be stale-but-tree-identical after a squash merge** — same content, different hash, inflating `allChangedFiles` with the last merged PR's files. Fix with `git fetch origin` + explicit `--base origin/main` (the only option in a worktree, where `fetch origin main:main` is refused because `main` is checked out in the primary tree). Only when the current branch IS the stale `main` and `git diff origin/main HEAD --stat` is empty may `git reset origin/main` (never `--hard`) realign it.
- **`docs/public/llms-full.txt` is auto-regenerated by the `update-llms.yaml` PR workflow whenever `docs/src/content/docs/**` changes** — a bot commit lands on the branch shortly after pushing docs edits. Never hand-edit it; `git pull` before continuing, and when CodeRabbit flags stale wording inside it, fix the source `.mdx`.
- **CodeRabbit and oxlint-tsgolint give contradictory orders on Bun's `expect(...).rejects.toThrow(...)`** — CodeRabbit flags the unawaited form as a race; the repo's type-aware lint hard-rejects the `await` (`await-thenable` + `no-confusing-void-expression`, via bun-types declaring it `void`). The lint gate wins: keep the unawaited form (the convention #534 set repo-wide), decline the finding on-thread citing the conflict, and don't re-litigate per PR.
- **Content filtering blocks policy/legal boilerplate** — generating a Contributor Covenant or license text can trip API filtering. Ask the user to copy it from the official source.
- **Files written under `/tmp` by this agent's own Bash/Write calls can vanish between tool calls.** Write anything that must survive several calls to a real Windows path (e.g. `C:/Users/<user>/AppData/Local/Temp/<task-name>/`); Bun/Node on Windows don't resolve Git-Bash-style `/c/Users/...` paths.

## Topic files

- [Coverage measurement](project_coverage_measurement.md) — reproducing CI's merged number; the cache-busting import that fakes a coverage gap
- [Typecheck and build](project_typecheck_and_build.md) — what tsc actually checks, the `rules.d.ts` prelude, embedding files via a sync Bun macro
- [ADR briefing budget](project_adr_briefing_budget.md) — measuring a section against the 2000-char cap; `review-context` needs `--verbose` to return prose
- [CI run behavior](project_ci_run_behavior.md) — a conflicting PR runs nothing; editing a PR body cancels the run and fakes a coverage regression
- [Verify agent claims](feedback_verify_agent_claims.md) — agents misquote ADRs and invent supporting detail; check every quote mechanically
- [Verify agents on TS changes must typecheck](feedback_verify_agents_run_typecheck.md) — `bun test`+lint+format missed a `noUnusedParameters` error a subagent self-reported as clean
- [Pick the right enforcement layer](feedback_prefer_tests_over_adr_rules.md) — syntax → lint rule; behaviour → test; governance → ADR rule; CLI behaviour → built-in
- [Answer every review finding on its own thread](feedback_reply_on_review_threads.md) — declines especially; a summary comment does not close the loop
- [Throw UserError in boundary-wrapped guards](feedback_throw_usererror_in_guards.md) — not `logError` + `exitWith(1)`
- [Docs are forward-only and version-independent](feedback_forward_only_docs.md) — no pinned versions or drift-prone counts; nothing enforces this
- [Claude Code hooks config](project_claude_code_hooks_config.md) — hook commands carry no shell syntax, `WorktreeCreate` contract, cloud env `SessionStart` bun-install workaround
- [PR review thread triage](project_pr_review_thread_triage.md) — REST hides resolution state; use the GraphQL `reviewThreads.isResolved` field
- [Rules engine follow-up](project_rules_engine_internals.md) — the one pending perf item no rule tracks
- [Parallel agents share one git index](feedback_parallel_agents_shared_worktree.md) — a stray stash/rebase from any one agent wipes every other agent's uncommitted work
- [Validate from a fresh clone before pushing](feedback_validate_from_fresh_clone.md) — a long-lived working dir masks generated-file ordering bugs CI will hit immediately
