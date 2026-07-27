---
name: feedback-parallel-agents-shared-worktree
description: Parallel subagents dispatched via the Agent tool (no isolation) share one working directory and one git index — a single stray git stash/rebase/reset from any one of them silently wipes every other agent's uncommitted work.
metadata:
  type: feedback
---

Dispatching many parallel subagents on disjoint file sets without `isolation: "worktree"` puts them all in the **same** working directory and git index. File-level disjointness prevents merge conflicts between their edits, but it does **not** protect against one agent running a repo-wide git operation — `git stash`, `git rebase`, `git reset` — for its own (often mistaken) reasons. That operation acts on the whole tree, including every other agent's in-progress, uncommitted edits, not just the caller's.

**Why:** During the TS7 + oxlint type-aware migration (12 parallel fix agents, ~170 files, none touching the same file), this happened twice in one session: one agent ran a bare `git stash` (apparently trying to check a "clean" baseline), and later another ran `git rebase`/reset against `origin/main` mid-flight. Both silently reverted every other agent's completed work in the working tree back to HEAD. Several agents caught it only via their own final self-verification pass (re-running oxlint/tests right before reporting done) and had to redo lost work; two agents' "done, tests pass" reports turned out to describe work that no longer existed by the time I checked. The full damage was only found and repaired by a centralized post-hoc audit: diffing every file each batch claimed to fix against `git status`, and restoring anything silently reverted from a `git stash` entry that happened to still hold the pre-accident snapshot.

**How to apply:**

- Before dispatching >1 parallel agent to edit files in a shared (non-worktree-isolated) working directory, explicitly instruct each one: never run `git stash`, `git rebase`, `git reset`, `git checkout <path>` (destructive form), or any other command that touches files outside its own assigned list — including for "let me check a clean baseline" purposes. Read-only git commands (`status`, `diff`, `log`) are fine.
- After all batches report done, don't trust individual "tests pass" reports at face value — run one centralized `git status` + a fresh full lint/typecheck/test sweep across the _whole_ diff before considering the work complete. A batch that finished early and exited is exactly the one most likely to have been silently clobbered by a later batch's accident, since it has no chance to self-detect after the fact.
- If corruption is found, `git stash list` before touching anything further — a prior recovery attempt (by whichever agent noticed first) may have already stashed a usable snapshot; restore surgically via `git checkout <stash> -- <path>` per missing file rather than a blanket `stash pop`, since other agents' _newer_, correct work may already coexist in the working tree alongside the reverted files.
- This risk is specific to the no-isolation mode. `isolation: "worktree"` on the Agent tool sidesteps it entirely (separate working directory per agent) at the cost of worktree setup overhead — worth it when the fleet is large enough that a single accident would be this expensive to detect and repair.
