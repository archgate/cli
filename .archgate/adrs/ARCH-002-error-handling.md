---
id: ARCH-002
title: Error Handling
domain: architecture
rules: true
files: ["src/**/*.ts"]
---

# Error Handling

## Context

CLI tools must provide clear, actionable error messages without exposing internal details. Inconsistent error handling produces confusing experiences: some errors show stack traces, others silently swallow failures, and exit codes are unpredictable for scripts and CI integrations.

**Alternatives considered:**

- **Try-catch everywhere** — Fine-grained control at the cost of deeply nested code, and errors get swallowed whenever a developer forgets to re-throw or log.
- **Error middleware / centralized handler** — A single `process.on("uncaughtException")` handler catches unexpected crashes but cannot distinguish user errors (invalid input) from bugs (null pointer), losing the "you made a mistake" vs "we have a bug" distinction.
- **Result types (Either/Result monad)** — The most type-safe option, but the ceremony is not justified for a CLI where nearly every error is terminal: print a message and exit.

The exit code model below covers every CLI case — success, expected failure, unexpected crash, user cancellation — and `logError()` keeps formatting consistent, giving users and CI systems predictable behavior without overengineering.

## Decision

Use four exit codes with clear semantics:

| Exit Code | Meaning           | When to Use                                                                   |
| --------- | ----------------- | ----------------------------------------------------------------------------- |
| `0`       | Success           | Operation completed successfully                                              |
| `1`       | Expected failure  | Invalid input, missing config, ADR violations found, operation cannot proceed |
| `2`       | Internal error    | Bugs, unhandled exceptions, unexpected crashes                                |
| `130`     | User cancellation | User pressed Ctrl+C / SIGINT during an interactive prompt                     |

**Error output conventions:**

- User-facing errors use `logError()` from `src/helpers/log.ts`, which formats with `styleText("red", ...)` and writes to stderr
- Actionable suggestions accompany error messages when possible (e.g., "Run `archgate init` to create a governance directory")
- No stack traces for user-triggered errors (exit code 1)
- Unexpected errors (exit code 2) may include stack traces when `DEBUG` or `TRACE` environment variables are set
- All error output goes to stderr, never stdout (stdout is reserved for command output and `--json` results)

## Do's and Don'ts

### Do

- **DO** use `logError()` from `src/helpers/log.ts` for user-facing errors — it writes to stderr, never stdout
- **DO** exit with code 1 for expected failures (missing config, invalid input, violations found)
- **DO** let unexpected errors crash naturally (exit code 2)
- **DO** provide actionable suggestions in error messages
- **DO** fall back to `process.cwd()` when `findProjectRoot()` returns null in commands that don't require `.archgate/` — e.g., `session-context` reads `~/.claude/projects/` and uses `process.cwd()` as its path key
- **DO** handle Inquirer's `ExitPromptError` as user cancellation — catch it in the top-level error boundary and exit with code 130 (SIGINT convention) without logging an error or sending to Sentry
- **DO** handle `UserError` in the top-level safety net — `main().catch()` in `src/cli.ts` MUST check `err instanceof UserError` and treat it as an expected failure (`logError()` + exit 1, NO Sentry capture) before falling through to the exit-2 + `captureException()` path, mirroring `handleCommandError()`. Only non-`UserError` errors reaching `main().catch()` are internal errors for Sentry

### Don't

- **DON'T** catch and swallow unexpected errors — let them propagate
- **DON'T** show stack traces for user errors
- **DON'T** use `console.error()` directly — use `logError()` for consistent formatting
- **DON'T** use `console.log()` or `console.warn()` directly in helper or engine files — use `logInfo()` or `logWarn()` (command files are the I/O layer and may use console directly)
- **DON'T** exit with code 0 when an operation fails
- **DON'T** use exit codes other than 0, 1, 2, or 130
- **DON'T** send user-cancellation errors (`ExitPromptError` from Inquirer) to Sentry — filter them in `beforeSend`
- **DON'T** send `UserError` to Sentry from any handler, including the `main().catch()` safety net — it means the user or their environment must fix something, and capturing it floods Sentry with non-bugs (incident CLI-5)

## Implementation Pattern

### Good Example

```typescript
// Expected failure — throw UserError and let the command's error boundary
// log it and exit 1 (ARCH-012). Calling logError + exit here would bypass it.
import { UserError } from "../helpers/user-error";

if (!existsSync(resolve(projectRoot, ".archgate/adrs"))) {
  throw new UserError(
    "No .archgate/ directory found. Run `archgate init` to initialize governance."
  );
}

// Validation failure — report and exit with code 1
const exitCode = getExitCode(await runChecks(adrs)); // 0 clean, 1 violations
// exitWith() flushes telemetry/Sentry and tags the outcome; a bare
// process.exit() here would skip both.
await exitWith(exitCode);
```

### Bad Example

```typescript
// BAD: swallowing errors silently — caller never learns anything failed
try {
  await loadConfig();
} catch {}

// BAD: console.error directly — no consistent formatting
console.error("Something went wrong");

// BAD: non-standard exit code — scripts cannot interpret this
process.exit(42);

// BAD: stack trace for a simple validation failure
try {
  validateInput(args);
} catch (e) {
  console.error(e);
  process.exit(1);
}
```

## Consequences

### Positive

- **Consistent error experience** — The same error format regardless of which command fails
- **Exit codes enable scripting** — CI systems and shell scripts branch on 0/1/2 with clear semantics
- **Clear separation between user errors and bugs** — Exit code 1 means "you need to fix something," exit code 2 means "we have a bug"
- **Actionable messages reduce support burden** — Telling users what to do next prevents repeated "how do I fix this?" questions

### Negative

- **Debugging requires environment variables** — Stack traces and internal state are available only with `DEBUG` or `TRACE` set. Intentional, but it slows contributors unfamiliar with the convention.

### Risks

- **Swallowed errors in async code** — Async functions that catch without re-throwing fail silently. Bun's unhandled-rejection exit is a safety net, but the message may be unclear.
  - **Mitigation:** Manual review is the control here — reviewers MUST reject any `try`/`catch` that neither logs nor re-throws. The `use-log-error` and `use-log-helpers` rules detect direct `console.*` usage only; neither can see an empty `catch`, so a green `archgate check` is not evidence that nothing is swallowed.
- **Exit code 2 masking real issues** — An unexpected error inside a rule file exits 2 ("internal error") rather than 1 ("violations"), which can confuse CI that only checks for non-zero.
  - **Mitigation:** The check engine wraps rule execution in timeout and error boundaries, reporting rule errors separately from violations; `--verbose` shows which rules errored.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-002/use-log-error`: Scans all source files (excluding `helpers/log.ts` and test files) for `console.error()` usage and flags violations. Severity: `error`.
- **Archgate rule** `ARCH-002/use-log-helpers`: Scans helper and engine files for direct `console.log()`, `console.warn()`, or `console.info()` usage. Excludes `helpers/log.ts` (canonical implementation), `engine/reporter.ts` (check output system), `helpers/login-flow.ts` (interactive device flow UI), and test files. Command files are exempt since they are the I/O layer. Severity: `error`.
- **Archgate rule** `ARCH-002/exit-code-convention`: Scans all source files for `process.exit()` calls and verifies the exit code is 0, 1, 2, or 130. Severity: `error`.

### Manual Enforcement

Code reviewers MUST verify:

1. Error messages include actionable suggestions where possible
2. Expected failures exit with code 1, not code 2
3. No try-catch blocks that swallow errors without logging or re-throwing

## References

- [POSIX exit code conventions](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html#tag_18_08_02)
- [ARCH-003 — Output Formatting](./ARCH-003-output-formatting.md) — Complements this ADR with output conventions (stderr for errors, stdout for results)
