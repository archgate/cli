---
name: feedback-throw-usererror-in-guards
description: In command actions with a full error boundary, throw UserError instead of manual logError + exitWith(1)
metadata:
  type: feedback
---

In command actions whose body is fully wrapped in try/catch → `handleCommandError`, early-return guards should `throw new UserError(...)` rather than `logError(...) + await exitWith(1) + return`.

**Why:** User review feedback on PR #467 (both guards in `check.ts`). The boundary already does logError + exit 1 without Sentry for UserError — the manual triple is redundant ceremony and drifts from the `user-error.ts` doctrine ("helpers throw UserError").

**How to apply:** When adding or touching a guard inside a boundary-wrapped action, prefer the throw. Note the test-shape difference: the exit spy then sees `exitWith(1, { errorKind: "user" })`, not `exitWith(1)`. Don't mass-convert other commands unprompted — apply opportunistically when editing them.
