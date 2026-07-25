---
id: ARCH-001
title: Command Structure
domain: architecture
rules: true
files: ["src/commands/**/*.ts"]
---

## Context

The CLI needs a consistent pattern for defining and registering commands. As the command surface grows, the registration mechanism must scale without introducing hidden coupling or making the dependency graph opaque.

**Alternatives considered:**

- **Auto-discovery via `executableDir()`** — Commander.js can scan a directory for executables, but that hides the dependency graph (no type-checked reference, so dead commands are undetectable) and forces each command to be a standalone executable, preventing in-process testing.
- **Plugin-based registration** — Manifest- or hook-based self-registration (Oclif, Clipanion) buys third-party extensibility at the cost of indirection that obscures which code handles which command — overkill for a finite internal command set.
- **Single-file command map** — One file mapping names to handlers is simple but becomes a monolith that grows with every command, causing frequent merge conflicts and poor readability.

The explicit register pattern balances these: each command owns its registration, the entry point makes all commands visible at a glance, and in-process execution enables testing without process spawning.

## Decision

Commands live in src/commands/ and export a register\*Command(program) function. The main entry point (src/cli.ts) explicitly imports and calls each register function. Subcommands (e.g., adr create, adr list) use nested directories with an index.ts that composes the subcommand group.

**Key constraints:**

1. **One command per file** — Each .ts file in src/commands/ defines exactly one command (or one command group via its index.ts)
2. **Explicit registration** — Every command must be manually imported and registered in src/cli.ts. No auto-discovery.
3. **Thin commands** — Command files handle I/O only: parse arguments, call engine/helpers, format output. No business logic.
4. **In-process execution** — Commands run in the same Bun process as the CLI entry point. No child process spawning.
5. **main() wrapper in entry point** — All async bootstrap logic in src/cli.ts MUST be wrapped in an async function main() called via .catch(). Top-level await is forbidden in the entry point.

## Do's and Don'ts

### Do

- **DO** export a register\*Command function from each command module
- **DO** keep commands thin: parse args, call helpers/engine, format output
- **DO** use src/commands/<name>.ts for top-level commands
- **DO** use src/commands/<name>/index.ts for command groups with subcommands
- **DO** import the register function explicitly in src/cli.ts
- **DO** wrap all async logic in src/cli.ts in an async function main() and call it as main().catch((err) => { logError(String(err)); process.exit(2); }) — this is required for bun build --compile --bytecode compatibility

### Don't

- **DON'T** put business logic in command files — move it to src/engine/, src/helpers/, or src/formats/
- **DON'T** use executableDir() for command discovery
- **DON'T** call .parse() in command files — the entry point handles parsing
- **DON'T** create commands that spawn child processes for subcommand execution
- **DON'T** use top-level await in src/cli.ts — bun build --compile --bytecode (the binary compiler) rejects it even though bun run and tsc accept it. The symptom is a build-time parse error: "await" can only be used inside an "async" function

## Implementation Pattern

### Good Example

```typescript
// src/commands/check.ts — thin command that delegates to engine
import type { Command } from "@commander-js/extra-typings";
import { loadRuleAdrs } from "../engine/loader";
import { runChecks } from "../engine/runner";
import { reportConsole, reportJSON, getExitCode } from "../engine/reporter";

export function registerCheckCommand(program: Command) {
  program
    .command("check")
    .description("Run automated ADR compliance checks")
    .option("--json", "Output results as JSON")
    .action(async (opts) => {
      const adrs = await loadRuleAdrs();
      const results = await runChecks(adrs);
      if (opts.json) reportJSON(results);
      else reportConsole(results);
      process.exit(getExitCode(results));
    });
}
```

```typescript
// src/cli.ts — explicit imports make all commands visible
import { registerCheckCommand } from "./commands/check";
import { registerInitCommand } from "./commands/init";

registerInitCommand(program);
registerCheckCommand(program);
```

### Bad Example

```typescript
// BAD: business logic inside command file
export function registerCheckCommand(program: Command) {
  program.command("check").action(async () => {
    const files = await glob("src/**/*.ts");
    for (const file of files) {
      const content = await Bun.file(file).text();
      const violations = content.match(/console\.error/g);
      // ... complex processing that belongs in src/engine/ ...
    }
  });
}
```

### Entry Point main() Pattern

bun build --compile --bytecode — the command used to produce standalone binaries — rejects top-level await at parse time, even though bun run and tsc both accept it. All async bootstrap logic in src/cli.ts MUST be wrapped in an async function main().

```typescript
// src/cli.ts — GOOD: all async logic wrapped in main()
import { logError } from "./helpers/log";

// Synchronous bootstrap checks can remain at top level
createPathIfNotExists(paths.cacheFolder);

async function main() {
  await installGit(); // async logic goes inside main()

  const program = new Command().name("archgate").version(packageJson.version);
  registerInitCommand(program);
  // ... register other commands ...

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  logError(String(err));
  process.exit(2);
});
```

```typescript
// src/cli.ts — BAD: top-level await breaks bun build --compile --bytecode
await installGit(); // ERROR: "await" can only be used inside an "async" function
await program.parseAsync(process.argv); // also breaks
```

### Subcommand Group Pattern

```typescript
// src/commands/adr/index.ts — composes subcommand group (contains real logic)
import type { Command } from "@commander-js/extra-typings";
import { registerAdrCreateCommand } from "./create";
import { registerAdrListCommand } from "./list";

export function registerAdrCommand(program: Command) {
  const adr = program
    .command("adr")
    .description("Manage Architecture Decision Records");

  registerAdrCreateCommand(adr);
  registerAdrListCommand(adr);
}
```

## Consequences

### Positive

- **In-process execution enables testing** — Commands can be tested by calling register\*Command() directly, without spawning subprocesses or mocking executables
- **Explicit imports make dependencies clear** — Opening src/cli.ts shows every command the CLI supports. No hidden commands loaded at runtime.
- **Subcommand nesting is straightforward** — Command groups use the same pattern as top-level commands, with an index.ts that composes children
- **Type-safe registration** — @commander-js/extra-typings provides full type inference for options and arguments within each register function
- **Binary-compatible entry point** — The main() wrapper ensures src/cli.ts compiles cleanly with bun build --compile --bytecode for standalone binary distribution

### Negative

- **Manual import bookkeeping** — Each new command requires an import and registration call in src/cli.ts. Minor overhead at this command count.
- **No hot-reload of commands** — Adding a command requires restarting the CLI process. Acceptable for a development tool.
- **Entry-point indirection** — Because top-level await is forbidden, src/cli.ts carries a main()/.catch() scaffold instead of straight-line bootstrap code.

### Risks

- **Stale imports when commands are removed** — Deleting a command file without removing its import in src/cli.ts leaves a dangling reference.
  - **Mitigation:** TypeScript catches it at compile time; the bun run typecheck step in the validation pipeline blocks it before production.
- **Command group index.ts confused with barrels** — The index.ts files in command group directories (e.g., src/commands/adr/index.ts) contain real composition logic, not re-exports.
  - **Mitigation:** ARCH-004 No Barrel Files explicitly permits index.ts files with logic.
- **Top-level await regression** — A developer unfamiliar with the --bytecode constraint may reintroduce top-level await in src/cli.ts.
  - **Mitigation:** The bun run build:check step in the validate pipeline catches it immediately — bun run validate fails locally before the code reaches CI.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** ARCH-001/register-function-export: Scans all command files under src/commands/ (excluding index.ts group files) and verifies each exports a register\*Command function. Severity: error.
- **Archgate rule** ARCH-001/no-business-logic: Detects complex data transformation patterns in command files that should be in helpers. Severity: error.
- **Archgate rule** ARCH-001\no-top-level-await-in-entry: Scans src/cli.ts for top-level await (await outside an indented function body) and flags it before a compile is needed. Severity: error.
- **Build check** bun run build:check: Compiles src/cli.ts with bun build --compile --bytecode as part of bun run validate. A top-level await regression causes an immediate, descriptive parse error. This remains the authoritative check; the rule above is a fast local early-warning.

### Manual Enforcement

Code reviewers MUST verify:

1. New commands are imported and registered in src/cli.ts
2. Command files delegate to engine/helpers for business logic
3. Command group index.ts files contain composition logic, not just re-exports
4. No top-level await has been introduced in src/cli.ts — all async logic must be inside main()

## References

- [Commander.js documentation](https://github.com/tj/commander.js)
- [ARCH-004 — No Barrel Files](./ARCH-004-no-barrel-files.md) — Permits index.ts with logic, forbids re-export-only barrels
- [ARCH-002 — Error Handling](./ARCH-002-error-handling.md) — logError and exit code conventions used in the main().catch() handler
