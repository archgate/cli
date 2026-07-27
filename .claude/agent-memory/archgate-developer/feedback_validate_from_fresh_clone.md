---
name: feedback-validate-from-fresh-clone
description: A long-lived local working directory accumulates gitignored, generated state that a truly fresh checkout (CI, a new clone) never has — running the full gate locally is not sufficient proof it will pass in CI.
metadata:
  type: feedback
---

Running `bun run validate` repeatedly in the same working directory across a long session is not equivalent to what CI sees. Gitignored files that get generated as a side effect of some command (here: `.archgate/rules.d.ts`, written by `archgate check`'s `loadRuleAdrs()` per [[project_rules_engine_internals]]) persist on disk once created, silently masking any ordering dependency on them for the rest of the session — `bun run validate` runs `lint` _before_ `check`, so a file that only `check` generates being required by `lint` never surfaced locally, because by the time `lint` ran, `check` had already run dozens of times earlier in the session and left the file behind.

**Why:** Pushed the TS7 type-aware linting migration (PR #534) after `bun run validate` passed clean locally many times over — CI failed immediately (`bun run lint`) with ~1127 findings, all `ctx.*` resolving to `any` in `.archgate/adrs/*.rules.ts` files. Reproduced by cloning the pushed branch fresh into a scratch directory and running `bun install --frozen-lockfile` there — confirmed instantly, matching CI exactly. The actual working directory this session ran in had accumulated `.archgate/rules.d.ts` from an early `archgate check` call and never lost it.

**How to apply:**

- Before pushing a change that touches lint/type config, tooling scripts, or anything else order-sensitive, `git clone --branch <branch> --single-branch <repo-url> <scratch-dir>` and run the validate pipeline there — not just in the working directory. This is the only way to see what a fresh checkout (CI, a new contributor's clone) actually experiences.
- When a fix depends on file-generation ordering, verify by deleting the generated file and re-running the specific command in the _existing_ working directory too (`rm .archgate/rules.d.ts && bun run lint`) — cheaper than a fresh clone and catches the same class of bug once you know to suspect it, but the fresh clone is what catches it when you don't yet know to suspect anything.
- `git show <ref>:<path> > <file>` mangles on Windows Git Bash when the ref contains no path separator ambiguity issues normally, but prefix `MSYS_NO_PATHCONV=1` defensively for any `git show <ref>:<path>` — it silently produces an empty file (via shell redirection succeeding before the mangled git command fails) rather than erroring loudly.
