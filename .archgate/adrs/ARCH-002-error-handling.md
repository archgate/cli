---
id: ARCH-002
title: Error Handling
domain: architecture
rules: true
files: ["src/**/*.ts"]
---

# Error Handling

## Context

CLI tools must provide clear, actionable error messages without exposing internal details to users. Inconsistent error handling leads to confusing experiences: some errors show stack traces, others silently swallow failures, and exit codes are unpredictable for scripts and CI integrations.

**Alternatives considered:**

- **Try-catch everywhere** — Wrapping every function in try-catch blocks provides fine-grained error control but leads to deeply nested code and often results in errors being caught and swallowed unintentionally. Developers forget to re-throw or log, and errors disappear silently.
- **Error middleware / centralized handler** — A single `process.on("uncaughtException")` handler catches all unhandled errors. This works for unexpected crashes but cannot distinguish between user errors (invalid input) and bugs (null pointer). All errors get the same treatment, losing the semantic distinction between "you made a mistake" and "we have a bug."
- **Result types (Either/Result monad)** — Encoding success/failure in return types (e.g., `Result<T, E>`) makes error handling explicit. This is the most type-safe approach but adds significant ceremony for a CLI where most errors are terminal (print message, exit). The overhead is not justified when the error handling strategy is "tell the user and exit."

The three-tier exit code model provides a simple contract that covers all CLI use cases: success, expected failure, and unexpected crash. Combined with `logError()` for consistent formatting, this gives users and CI systems predictable behavior without overengineering.

## Decision

Use three exit codes with clear semantics:

| Exit Code | Meaning          | When to Use                                                                   |
| --------- | ---------------- | ----------------------------------------------------------------------------- |
| `0`       | Success          | Operation completed successfully                                              |
| `1`       | Expected failure | Invalid input, missing config, ADR violations found, operation cannot proceed |
| `2`       | Internal error   | Bugs, unhandled exceptions, unexpected crashes                                |

**Error output conventions:**

- User-facing errors use `logError()` from `src/helpers/log.ts`, which formats with `styleText("red", ...)` and writes to stderr
- Actionable suggestions accompany error messages when possible (e.g., "Run `archgate init` to create a governance directory")
- No stack traces for user-triggered errors (exit code 1)
- Unexpected errors (exit code 2) may include stack traces when `DEBUG` or `TRACE` environment variables are set
- All error output goes to stderr, never stdout (stdout is reserved for command output and `--json` results)

## Do's and Don'ts

### Do

- Use `logError()` from `src/helpers/log.ts` for user-facing errors
- Exit with code 1 for expected failures (missing config, invalid input, violations found)
- Let unexpected errors crash naturally (exit code 2)
- Provide actionable suggestions in error messages
- Write errors to stderr (via `logError()`), not stdout
- **Commands that don't require `.archgate/` SHOULD fall back to `process.cwd()`** when `findProjectRoot()` returns null — e.g., `session-context` reads from `~/.claude/projects/` and uses `process.cwd()` as its path key when no project is found

### Don't

- Don't catch and swallow unexpected errors — let them propagate
- Don't show stack traces for user errors
- Don't use `console.error()` directly — use `logError()` for consistent formatting
- Don't use `console.log()` or `console.warn()` directly in helper or engine files — use `logInfo()` or `logWarn()` (command files are the I/O layer and may use console directly)
- Don't exit with code 0 when an operation fails
- Don't use exit codes other than 0, 1, or 2

## Implementation Pattern

### Good Example

```typescript
// Expected failure — user error with actionable suggestion
import { logError } from "../helpers/log";

const adrsPath = resolve(projectRoot, ".archgate/adrs");
if (!existsSync(adrsPath)) {
  logError(
    "No .archgate/ directory found. Run `archgate init` to initialize governance."
  );
  process.exit(1);
}
```

```typescript
// Validation failure — report and exit with code 1
const results = await runChecks(adrs);
const exitCode = getExitCode(results); // 0 if clean, 1 if violations
process.exit(exitCode);
```

### Bad Example

```typescript
// BAD: swallowing errors silently
try {
  const config = await loadConfig();
} catch {
  // Error is lost — caller has no idea something failed
}

// BAD: using console.error directly
console.error("Something went wrong"); // No consistent formatting

// BAD: non-standard exit code
process.exit(42); // Scripts cannot interpret this

// BAD: showing stack trace for user error
try {
  validateInput(args);
} catch (e) {
  console.error(e); // Prints stack trace for simple validation failure
  process.exit(1);
}
```

## Consequences

### Positive

- **Consistent error experience** — Users always see the same error format regardless of which command fails
- **Exit codes enable scripting** — CI systems and shell scripts can branch on 0/1/2 with clear semantics
- **Clear separation between user errors and bugs** — Exit code 1 means "you need to fix something," exit code 2 means "we have a bug"
- **Actionable messages reduce support burden** — Telling users what to do next prevents repeated "how do I fix this?" questions

### Negative

- **Debugging requires environment variables** — Detailed error context (stack traces, internal state) is only available with `DEBUG` or `TRACE` env vars. This is intentional but can slow down debugging for contributors unfamiliar with the convention.

### Risks

- **Swallowed errors in async code** — Async functions that catch errors without re-throwing can silently fail. Unhandled promise rejections in Bun terminate the process with a non-zero exit code, which provides a safety net, but the error message may be unclear.
  - **Mitigation:** The log helper convention makes explicit error handling visible in code review. The `use-log-error` rule flags direct `console.error()` usage, and the `use-log-helpers` rule flags direct `console.log()`/`console.warn()` in helper and engine files, nudging developers toward the standard pattern.
- **Exit code 2 masking real issues** — If an unexpected error occurs in a rule file, the CLI exits with code 2 ("internal error") rather than code 1 ("violations"). This could confuse CI systems that only check for non-zero exit.
  - **Mitigation:** The check engine wraps rule execution with timeout and error boundaries, reporting rule errors separately from violations. The `--verbose` flag shows which rules errored.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-002/use-log-error`: Scans all source files (excluding `helpers/log.ts` and test files) for `console.error()` usage and flags violations. Severity: `error`.
- **Archgate rule** `ARCH-002/use-log-helpers`: Scans helper and engine files for direct `console.log()`, `console.warn()`, or `console.info()` usage. Excludes `helpers/log.ts` (canonical implementation), `engine/reporter.ts` (check output system), `helpers/login-flow.ts` (interactive device flow UI), and test files. Command files are exempt since they are the I/O layer. Severity: `error`.
- **Archgate rule** `ARCH-002/exit-code-convention`: Scans all source files for `process.exit()` calls and verifies the exit code is 0, 1, or 2. Severity: `error`.

### Manual Enforcement

Code reviewers MUST verify:

1. Error messages include actionable suggestions where possible
2. Expected failures exit with code 1, not code 2
3. No try-catch blocks that swallow errors without logging or re-throwing

## References

- [POSIX exit code conventions](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html#tag_18_08_02)
- [ARCH-003 — Output Formatting](./ARCH-003-output-formatting.md) — Complements this ADR with output conventions (stderr for errors, stdout for results)
