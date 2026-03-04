---
id: ARCH-007
title: Cross-Platform Subprocess Execution
domain: architecture
rules: true
files:
  - "src/**/*.ts"
---

## Context

The Archgate CLI runs on macOS, Linux, and Windows. Several operations require spawning subprocesses: git commands (`git ls-files`, `git diff`), editor CLI calls (`claude plugin install`, `copilot plugin install`), archive extraction (`tar -xzf`), and package management (`npm install -g`). These subprocesses must work identically on all three platforms.

Bun provides two subprocess APIs:

- **`Bun.$` (shell template literals)** — A shell-like API that pipes commands through a subprocess shell. Convenient syntax (`await Bun.$\`git ls-files\`.text()`), but relies on platform-specific shell behavior.
- **`Bun.spawn` (array-based)** — A lower-level API that executes a command directly (no intermediate shell). Takes an array of arguments, explicit pipe configuration, and returns a process handle with `stdout`, `stderr`, and `exited` properties.

**The problem:** `Bun.$` hangs on Windows. The shell subprocess does not properly close stdin/stdout pipes, causing deadlocks that block the calling thread indefinitely. When the Archgate CLI runs as an MCP server inside Claude Code or Cursor, this deadlock freezes the entire editor's agent interface — the user must force-kill the process. This was discovered in production and fixed in commit `ca33377`, which replaced all `Bun.$` calls with `Bun.spawn`.

**Alternatives considered:**

- **`Bun.$` with `.nothrow().quiet()`** — Adding error handling modifiers does not resolve the pipe deadlock. The hang occurs at the pipe level before any Bun-level error handling takes effect.
- **`node:child_process` (`execFile`, `spawn`)** — Node.js subprocess APIs work cross-platform but are callback-based or require manual stream wiring. `Bun.spawn` provides the same array-based execution model with native Promise/async support and direct `Bun.file`-compatible stdout.
- **Third-party libraries (`execa`, `cross-spawn`)** — These add production dependencies that [ARCH-006](./ARCH-006-dependency-policy.md) explicitly prohibits when Bun built-ins suffice. `Bun.spawn` covers all use cases without external packages.

For Archgate, every subprocess call is either a git command, an editor CLI invocation, or a system tool (`tar`, `npm`). All of these are simple array-based command executions that do not require shell features (pipes, globbing, redirection). `Bun.spawn` is the correct tool.

## Decision

All subprocess execution in the Archgate CLI MUST use `Bun.spawn` with array-based arguments. The `Bun.$` shell template literal API is **forbidden** in all source files.

This decision covers:

- Git operations (`git ls-files`, `git diff`, `git status`)
- Editor CLI calls (`claude plugin marketplace add`, `copilot plugin install`)
- System tool invocations (`tar`, `npm`)
- Any other subprocess execution added in the future

This decision does NOT cover:

- Test files — test helpers may use `Bun.$` if tests only run on a single platform (though `Bun.spawn` is still preferred)
- Build scripts — scripts that explicitly target a single platform are exempt

`Bun.spawn` will be used alongside:

- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — `Bun.spawn` is a Bun built-in, no external dependency needed
- [ARCH-002 — Error Handling](./ARCH-002-error-handling.md) — Subprocess failures MUST be handled with proper error messages and exit codes

## Do's and Don'ts

### Do

- **DO** use `Bun.spawn(["command", "arg1", "arg2"], { stdout: "pipe", stderr: "pipe" })` for commands whose output you need to capture
- **DO** read stdout via `new Response(proc.stdout).text()` — this is the idiomatic Bun pattern for consuming a `ReadableStream`
- **DO** always `await proc.exited` after reading stdout to ensure the process has terminated
- **DO** use `stdout: "inherit"` and `stderr: "inherit"` for commands whose output should go directly to the terminal (e.g., `npm install -g`)
- **DO** wrap CLI availability checks in `try/catch` returning a boolean — the command may not exist on the system
- **DO** pass `cwd` via the options object when the command must run in a specific directory
- **DO** extract a helper function (e.g., `run(cmd, opts)` or `runGit(args, cwd)`) when multiple subprocess calls share the same pattern within a module

### Don't

- **DON'T** use `Bun.$` template literals (`Bun.$\`command\``) — they hang on Windows due to pipe deadlocks
- **DON'T** import `$` from `"bun"` — this is the Bun shell API that causes Windows deadlocks
- **DON'T** use shell features (pipes `|`, redirects `>`, globbing `*`) in subprocess arguments — `Bun.spawn` executes commands directly without a shell
- **DON'T** forget to `await proc.exited` — reading stdout alone does not guarantee the process has terminated
- **DON'T** use `node:child_process` when `Bun.spawn` provides the same capability — prefer Bun built-ins per [ARCH-006](./ARCH-006-dependency-policy.md)

## Implementation Pattern

### Good Example

```typescript
// Capture command output (git, tar, etc.)
async function run(
  cmd: string[],
  opts?: { cwd?: string }
): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout };
}

// Usage
const { exitCode, stdout } = await run(["git", "diff", "--cached", "--name-only"], { cwd: projectRoot });
const files = stdout.trim().split("\n").filter(Boolean);
```

```typescript
// CLI availability check
async function isClaudeCliAvailable(): Promise<boolean> {
  try {
    const { exitCode } = await run(["claude", "--version"]);
    return exitCode === 0;
  } catch {
    return false; // Command not found on PATH
  }
}
```

```typescript
// Inherit output for interactive/visible commands
const proc = Bun.spawn(["npm", "install", "-g", "archgate@latest"], {
  stdout: "inherit",
  stderr: "inherit",
});
const exitCode = await proc.exited;
```

### Bad Example

```typescript
// BAD: Bun.$ hangs on Windows — pipe deadlock
import { $ } from "bun";
const result = await $`git ls-files`.text();

// BAD: .nothrow().quiet() does not fix the pipe issue
const result = await $`git diff --cached --name-only`.nothrow().quiet().text();

// BAD: Shell features don't work with Bun.spawn
Bun.spawn(["git diff --cached | head -5"]); // This is a single argument, not a pipeline
```

## Consequences

### Positive

- **Cross-platform reliability** — `Bun.spawn` works identically on macOS, Linux, and Windows. No platform-specific pipe handling differences.
- **No deadlocks** — Array-based execution avoids the stdin/stdout pipe issues that cause `Bun.$` to hang on Windows.
- **MCP server safety** — The CLI runs as a long-lived MCP server inside editors. A subprocess deadlock would freeze the entire agent interface. `Bun.spawn` eliminates this risk.
- **Explicit argument handling** — Array-based arguments prevent shell injection vulnerabilities. Each argument is passed directly to the command, not interpreted by a shell.
- **No shell dependency** — The command does not require a shell interpreter (bash, cmd.exe, PowerShell) to be available or configured correctly.
- **Consistent error handling** — `proc.exited` returns a Promise that resolves to the exit code, making error checking uniform across all subprocess calls.

### Negative

- **More verbose syntax** — `Bun.spawn(["git", "ls-files"], { stdout: "pipe" })` is more verbose than `Bun.$\`git ls-files\``. The convenience of template literals is lost.
  - This is mitigated by extracting `run()` or `runGit()` helper functions within each module.
- **No shell features** — Pipelines (`cmd1 | cmd2`), redirects (`> file`), and glob expansion (`*.ts`) are not available. Each must be implemented in JavaScript.
  - The Archgate CLI does not use any of these shell features. All subprocess calls are simple command executions.
- **Manual stream consumption** — Reading stdout requires `new Response(proc.stdout).text()` instead of the simpler `.text()` chain on `Bun.$`.

### Risks

- **Future Bun.$ fix** — Bun may fix the Windows pipe issue in a future version, making `Bun.$` safe again. At that point, the project could relax this restriction.
  - **Mitigation:** The ADR stands until verified on all three platforms with the fixed Bun version. A relaxation requires updating this ADR with the minimum safe Bun version.
- **Complex subprocess needs** — A future feature may require shell features (pipelines, redirects) that `Bun.spawn` cannot provide.
  - **Mitigation:** Implement the pipeline logic in JavaScript (spawn multiple processes, pipe streams manually). If this becomes frequent, evaluate adding a subprocess helper library as an approved dependency under [ARCH-006](./ARCH-006-dependency-policy.md).

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-007/no-bun-shell`: Scans all TypeScript source files for `Bun.$` usage and `$` imports from `"bun"`. Severity: `error` (hard blocker).

### Manual Enforcement

Code reviewers MUST verify:

1. No `Bun.$` template literals appear in new or modified code
2. No `import { $ } from "bun"` or `import { $, ... } from "bun"` statements exist
3. All subprocess calls use `Bun.spawn` with array-based arguments
4. `proc.exited` is awaited after reading stdout/stderr
5. CLI availability checks are wrapped in `try/catch`

### Exceptions

Test files (`tests/**/*.ts`) MAY use `Bun.$` if the test targets a single platform. However, `Bun.spawn` is still preferred for consistency. Any exception must be documented with a comment explaining why `Bun.$` is acceptable in that specific case.

## References

- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — Mandates Bun built-ins over external packages; updated to remove `Bun.$` recommendation
- [ARCH-002 — Error Handling](./ARCH-002-error-handling.md) — Defines error handling standards for subprocess failures
- [Bun.spawn documentation](https://bun.sh/docs/api/spawn)
- [Bun.$ documentation](https://bun.sh/docs/runtime/shell) — Documents the shell API that this ADR prohibits
- Commit `ca33377` — The production fix that migrated all `Bun.$` calls to `Bun.spawn`
