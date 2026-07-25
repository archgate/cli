---
id: ARCH-007
title: Cross-Platform Subprocess Execution
domain: architecture
rules: true
files:
  - "src/**/*.ts"
---

## Context

The Archgate CLI runs on macOS, Linux, and Windows. Several operations spawn subprocesses: git commands (`git ls-files`, `git diff`), editor CLI calls (`claude plugin install`, `copilot plugin install`), archive extraction (`tar -xzf`), and package management (`npm install -g`). These must behave identically on all three platforms.

Bun provides two subprocess APIs:

- **`Bun.$` (shell template literals)** — Convenient syntax (`await Bun.$\`git ls-files\`.text()`) that pipes commands through a platform-specific subprocess shell. **It hangs on Windows:** the shell subprocess does not properly close stdin/stdout pipes, causing deadlocks that block the calling thread indefinitely.
- **`Bun.spawn` (array-based)** — Executes a command directly with no intermediate shell. Takes an argument array and explicit pipe configuration, and returns a process handle with `stdout`, `stderr`, and `exited`.

**Alternatives considered:**

- **`Bun.$` with `.nothrow().quiet()`** — The hang occurs at the pipe level, before any Bun-level error handling takes effect.
- **`node:child_process` (`execFile`, `spawn`)** — Works cross-platform but is callback-based or requires manual stream wiring; `Bun.spawn` provides the same array-based execution model with native Promise/async support.
- **Third-party libraries (`execa`, `cross-spawn`)** — Production dependencies that [ARCH-006](./ARCH-006-dependency-policy.md) prohibits when Bun built-ins suffice.

Every Archgate subprocess call is a git command, an editor CLI invocation, or a system tool (`tar`, `npm`) — simple array-based executions that need no shell features (pipes, globbing, redirection). `Bun.spawn` is the correct tool.

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

- **DO** use `Bun.spawn(["command", "arg1"], { stdout: "pipe", stderr: "pipe" })` when you need to capture output
- **DO** read stdout via `new Response(proc.stdout).text()` — the idiomatic Bun way to consume a `ReadableStream`
- **DO** always `await proc.exited` after reading stdout, to ensure the process terminated
- **DO** use `stdout: "inherit"` and `stderr: "inherit"` for commands whose output belongs on the terminal (e.g., `npm install -g`)
- **DO** wrap CLI availability checks in `try/catch` returning a boolean — the command may not exist on the system
- **DO** pass `cwd` via the options object when the command must run in a specific directory
- **DO** extract a helper (`run(cmd, opts)`, `runGit(args, cwd)`) when a module makes several subprocess calls of the same shape
- **DO** use `Promise.allSettled` for concurrent spawns that can reject, inspecting statuses only after all settle so every process has fully exited before the caller proceeds (reference: `getGitTrackedFiles` in `src/engine/git-files.ts`)

### Don't

- **DON'T** use `Bun.$` template literals (`Bun.$\`command\``) — they hang on Windows due to pipe deadlocks
- **DON'T** import `$` from `"bun"` — this is the Bun shell API that causes Windows deadlocks
- **DON'T** use shell features (pipes `|`, redirects `>`, globbing `*`) in subprocess arguments — `Bun.spawn` executes commands directly without a shell
- **DON'T** forget to `await proc.exited` — reading stdout alone does not guarantee termination
- **DON'T** use `node:child_process` when `Bun.spawn` provides the same capability — prefer Bun built-ins per [ARCH-006](./ARCH-006-dependency-policy.md)
- **DON'T** race spawns with `Promise.all` when one rejection can abandon a still-running sibling — the abandoned process keeps its `cwd` handle open, which on Windows locks that directory (`EBUSY` on removal)

## Implementation Pattern

### Good Example

```typescript
// Capture command output (git, tar, etc.)
async function run(cmd: string[], opts?: { cwd?: string }) {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  // Drain both pipes concurrently. Awaiting stdout alone deadlocks when the
  // child fills the stderr buffer, because `proc.exited` never resolves.
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

// CLI availability check — the command may not be on PATH
async function isClaudeCliAvailable(): Promise<boolean> {
  try {
    return (await run(["claude", "--version"])).exitCode === 0;
  } catch {
    return false;
  }
}

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

- **Cross-platform reliability** — `Bun.spawn` behaves identically on macOS, Linux, and Windows; no platform-specific pipe handling
- **No deadlocks** — Array-based execution avoids the stdin/stdout pipe issues that hang `Bun.$` on Windows
- **Explicit argument handling** — Each argument goes directly to the command rather than through a shell, preventing shell injection
- **No shell dependency** — No shell interpreter (bash, cmd.exe, PowerShell) needs to be present or correctly configured
- **Consistent error handling** — `proc.exited` resolves to the exit code, making error checking uniform across all subprocess calls

### Negative

- **More verbose syntax** — `Bun.spawn(["git", "ls-files"], { stdout: "pipe" })` costs more than `Bun.$\`git ls-files\``; mitigated by per-module `run()`/`runGit()` helpers.
- **No shell features** — Pipelines (`cmd1 | cmd2`), redirects (`> file`), and glob expansion (`*.ts`) must be implemented in JavaScript. Archgate uses none of them.
- **Manual stream consumption** — Reading stdout requires `new Response(proc.stdout).text()` instead of a `.text()` chain.

### Risks

- **Future Bun.$ fix** — Bun may fix the Windows pipe issue, making `Bun.$` safe again.
  - **Mitigation:** The prohibition stands until verified on all three platforms; relaxing it requires updating this ADR with the minimum safe Bun version.
- **Complex subprocess needs** — A future feature may want pipelines or redirects that `Bun.spawn` cannot provide.
  - **Mitigation:** Implement the pipeline in JavaScript (spawn multiple processes, pipe streams manually). If that becomes frequent, evaluate a subprocess helper library as an approved dependency under [ARCH-006](./ARCH-006-dependency-policy.md).

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
