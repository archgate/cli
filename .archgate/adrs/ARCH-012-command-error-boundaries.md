---
id: ARCH-012
title: Command Error Boundaries
domain: architecture
rules: true
files: ["src/commands/**/*.ts"]
---

# Command Error Boundaries

## Context

Async command actions that lack try-catch error boundaries produce poor user experiences when they fail. Without explicit error handling:

1. Errors propagate to the top-level `main().catch()` in `cli.ts`, which exits with code 2 (internal error) and shows only the raw error message
2. Users cannot distinguish between a command failure (code 1) and a CLI bug (code 2)
3. Error messages lack context about what the command was trying to do

This was discovered during a repository-wide review where `review-context`, `session-context claude-code`, and `session-context cursor` all lacked error boundaries.

ARCH-002 defines the exit code convention and logging patterns, but does not require error boundaries in command actions. This ADR complements ARCH-002 by making error boundaries mandatory.

**Why not a global Commander.js error handler?** Commander provides `.exitOverride()` and `.configureOutput()` for parsing errors (unknown options, missing arguments), but these do **not** cover errors thrown inside async `.action()` callbacks. Commander's `preAction`/`postAction` hooks could theoretically wrap actions, but they don't catch async errors from the action body. The `main().catch()` in `cli.ts` catches unhandled rejections as a safety net (exit 2), but per-command try-catch is needed to produce contextual error messages and exit with code 1 instead of 2.

## Decision

Every async command action MUST wrap its body in a try-catch block that:

1. Catches errors from async operations
2. Formats them with `logError()` from `src/helpers/log.ts`
3. Exits with code 1 (expected failure) for user-facing errors

The top-level `main().catch()` in `cli.ts` remains as a safety net for truly unexpected errors (code 2), but it should never be the primary error handler for commands.

**Pattern:**

```typescript
.action(async (opts) => {
  try {
    // command logic
  } catch (err) {
    // Re-throw ExitPromptError so main().catch() handles Ctrl+C (exit 130)
    if (err instanceof Error && err.name === "ExitPromptError") throw err;
    logError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
});
```

**Exceptions:**

- Synchronous command actions (e.g., `clean`) that cannot throw async errors
- Command group index files that only register subcommands

## Do's and Don'ts

### Do

- Wrap every async command action body in a try-catch
- **Cover the ENTIRE action body** — the try block MUST start at the first statement of the action and end at the last. A boundary that wraps only part of the body (e.g., a single risky call) still lets errors from the uncovered statements escape to `main().catch()`, converting expected failures (exit 1) into internal crashes (exit 2 + Sentry). Incident: `check.ts` once wrapped only `loadRuleAdrs()` — a `UserError` thrown later by `runChecks()` escaped and was reported to Sentry (issue CLI-5)
- Use `logError()` for error messages in the catch block
- Exit with code 1 for expected failures
- **Re-throw `ExitPromptError` in command error boundaries** — Commands that use Inquirer prompts (directly or via helpers like `promptEditorSelection`) MUST re-throw `ExitPromptError` from the catch block so `main().catch()` handles Ctrl+C with exit code 130. Pattern: `if (err instanceof Error && err.name === "ExitPromptError") throw err;`

### Don't

- Don't rely on `main().catch()` as the only error handler for commands
- Don't scope the try-catch to a subset of the action body — partial boundaries pass the automated presence check while still leaking errors from uncovered statements
- Don't catch and silently swallow errors — always log them
- Don't exit with code 2 in command catch blocks — that code is reserved for unexpected crashes
- Don't catch `ExitPromptError` as a command failure — it represents user cancellation (Ctrl+C), not an error. Let it propagate to `main().catch()` for exit code 130 handling (see [ARCH-002](./ARCH-002-error-handling.md))

## Consequences

### Positive

- Users see contextual error messages instead of raw exception text
- Exit code 1 vs 2 distinction is preserved — scripts and CI can differentiate
- Every command handles its own failures gracefully

### Negative

- Minor boilerplate in every async command action

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-012/async-action-error-boundary`: Walks the AST (`ctx.ast`) of each async command action and enforces two things: (1) the action body contains a top-level try-catch, and (2) no top-level awaited statement sits _outside_ that try block — escaped awaits are the exact statements whose rejections bypass the boundary into `main().catch()` (incident CLI-5). Awaits of the sanctioned exit paths (`exitWith`, `handleCommandError`) are exempt — they end in `process.exit()` and cannot produce a meaningful rejection, so early-return guards remain allowed. Severity: `warning` (some commands may have valid reasons for alternative patterns). **Remaining limitation:** synchronous statements outside the try are not flagged — sync throws from prelude code (e.g. argument validation) still escape; keep preludes trivial or move them inside the try.
- **Archgate rule** `ARCH-012/exit-prompt-error-rethrow`: Verifies that async command actions with try-catch blocks include the `ExitPromptError` re-throw pattern. Severity: `error` — missing re-throws silently convert user cancellation (Ctrl+C, exit 130) into command failure (exit 1).

### Manual Enforcement

Code reviewers MUST verify that new async commands include error boundaries AND that the try block covers the entire action body — not just the statements the author expected to fail.

## References

- [ARCH-002 — Error Handling](./ARCH-002-error-handling.md) — Exit code convention and logError() requirement
- [ARCH-001 — Command Structure](./ARCH-001-command-structure.md) — Command file conventions
