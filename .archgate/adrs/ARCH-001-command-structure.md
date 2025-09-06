---
id: ARCH-001
title: Command Structure
domain: architecture
rules: true
files: ["src/commands/**/*.ts"]
---

## Context

The CLI needs a consistent pattern for defining and registering commands. As the command surface grows (init, check, adr, mcp, upgrade, clean), the registration mechanism must scale without introducing hidden coupling or making the dependency graph opaque.

**Alternatives considered:**

- **Auto-discovery via `executableDir()`** — Commander.js supports automatic command discovery by scanning a directory for executable files. This eliminates manual imports but hides the dependency graph: adding or removing a command has no type-checked reference, making dead command detection impossible. It also requires each command to be a standalone executable, which prevents in-process testing and forces separate process spawning for every subcommand invocation.
- **Plugin-based registration** — A plugin system where commands register themselves via a manifest or hook (similar to Oclif or Clipanion). This adds flexibility for third-party extensions but introduces significant complexity for an internal CLI with a known, finite set of commands. The indirection makes it harder to trace which code handles which command.
- **Single-file command map** — Define all commands in a single file as a map of name-to-handler. Simple but creates a monolithic file that grows with every command, making merge conflicts frequent and readability poor.

The explicit register pattern strikes the right balance: each command owns its registration logic, the entry point makes all commands visible at a glance, and in-process execution enables straightforward testing without process spawning.

## Decision

Commands live in src/commands/ and export a register*Command(program) function. The main entry point (src/cli.ts) explicitly imports and calls each register function. Subcommands (e.g., adr create, adr list) use nested directories with an index.ts that composes the subcommand group.

**Key constraints:**

1. **One command per file** — Each .ts file in src/commands/ defines exactly one command (or one command group via its index.ts)
2. **Explicit registration** — Every command must be manually imported and registered in src/cli.ts. No auto-discovery.
3. **Thin commands** — Command files handle I/O only: parse arguments, call engine/helpers, format output. No business logic.
4. **In-process execution** — Commands run in the same Bun process as the CLI entry point. No child process spawning.
5. **main() wrapper in entry point** — All async bootstrap logic in src/cli.ts MUST be wrapped in an async function main() called via .catch(). Top-level await is forbidden in the entry point.

## Do's and Don'ts

### Do

- Export a register*Command function from each command module
- Keep commands thin: parse args, call helpers/engine, format output
- Use src/commands/<name>.ts for top-level commands
- Use src/commands/<name>/index.ts for command groups with subcommands
- Import the register function explicitly in src/cli.ts
- Wrap all async logic in src/cli.ts in an async function main() and call it as main().catch((err) => { logError(String(err)); process.exit(2); }) — this is required for bun build --compile --bytecode compatibility

### Don't

- Don't put business logic in command files — move it to src/engine/, src/helpers/, or src/formats/
- Don't use executableDir() for command discovery
- Don't call .parse() in command files — the entry point handles parsing
- Don't create commands that spawn child processes for subcommand execution
- Don't use top-level await in src/cli.ts — bun build --compile --bytecode (the binary compiler) rejects it even though bun run and tsc accept it. The symptom is a build-time parse error: "await" can only be used inside an "async" function

## Implementation Pattern

### Good Example

```typescript
// src/commands/check.ts — thin command that delegates to engine
import type { Command } from "@commander-js/extra-typings";
import { loadRuleAdrs } from "../engine/loader";
import { runChecks } from "../engine/runner";
import { reportConsole, reportJSON, getExitCode } from "../engine/reporter";
import { logError } from "../helpers/log";

export function registerCheckCommand(program: Command) {
  program
    .command("check")
    .description("Run automated ADR compliance checks")
    .option("--json", "Output results as JSON")
    .option("--staged", "Only check staged files")
    .action(async (opts) => {
      const adrs = await loadRuleAdrs();
      const results = await runChecks(adrs, { staged: opts.staged });
      if (opts.json) {
        reportJSON(results);
      } else {
        reportConsole(results);
      }
      process.exit(getExitCode(results));
    });
}
```

```typescript
// src/cli.ts — explicit imports make all commands visible
import { registerCheckCommand } from "./commands/check";
import { registerInitCommand } from "./commands/init";
import { registerAdrCommand } from "./commands/adr";

registerInitCommand(program);
registerCheckCommand(program);
registerAdrCommand(program);
```

### Bad Example

```typescript
// BAD: business logic inside command file
export function registerCheckCommand(program: Command) {
  program.command("check").action(async () => {
    // Business logic should NOT be here
    const files = await glob("src/**/*.ts");
    for (const file of files) {
      const content = await Bun.file(file).text();
      const violations = content.match(/console\.error/g);
      // ... complex processing ...
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
if (!semver.satisfies(Bun.version, ">=1.2.21"))
  throw new Error("You need to update Bun to version 1.2.21 or higher");

createPathIfNotExists(paths.cacheFolder);

async function main() {
  await installGit(); // async logic goes inside main()

  const program = new Command().name("archgate").version(packageJson.version);
  registerInitCommand(program);
  // ... register other commands ...

  const updateCheckPromise = checkForUpdatesIfNeeded(packageJson.version);
  await program.parseAsync(process.argv);
  const notice = await updateCheckPromise;
  if (notice) console.log(notice);
}

main().catch((err) => {
  logError(String(err));
  process.exit(2);
});
```

```typescript
// src/cli.ts — BAD: top-level await breaks bun build --compile --bytecode
createPathIfNotExists(paths.cacheFolder);

await installGit(); // ERROR: "await" can only be used inside an "async" function

const program = new Command().name("archgate").version(packageJson.version);
await program.parseAsync(process.argv); // also breaks
```

### Subcommand Group Pattern

```typescript
// src/commands/adr/index.ts — composes subcommand group (contains real logic)
import type { Command } from "@commander-js/extra-typings";
import { registerAdrCreateCommand } from "./create";
import { registerAdrListCommand } from "./list";
import { registerAdrShowCommand } from "./show";
import { registerAdrUpdateCommand } from "./update";

export function registerAdrCommand(program: Command) {
  const adr = program
    .command("adr")
    .description("Manage Architecture Decision Records");

  registerAdrCreateCommand(adr);
  registerAdrListCommand(adr);
  registerAdrShowCommand(adr);
  registerAdrUpdateCommand(adr);
}
```

## Consequences

### Positive

- **In-process execution enables testing** — Commands can be tested by calling register*Command() directly, without spawning subprocesses or mocking executables
- **Explicit imports make dependencies clear** — Opening src/cli.ts shows every command the CLI supports. No hidden commands loaded at runtime.
- **Subcommand nesting is straightforward** — Command groups use the same pattern as top-level commands, with an index.ts that composes children
- **Type-safe registration** — Commander.js @commander-js/extra-typings provides full type inference for options and arguments within each register function
- **Binary-compatible entry point** — The main() wrapper pattern ensures src/cli.ts compiles cleanly with bun build --compile --bytecode for standalone binary distribution

### Negative

- **Manual import bookkeeping** — Each new command requires adding an import and registration call in src/cli.ts. This is a minor overhead for a CLI with fewer than 15 commands.
- **No hot-reload of commands** — Adding a new command requires restarting the CLI process. Acceptable for a development tool.

### Risks

- **Stale imports when commands are removed** — If a command file is deleted but its import in src/cli.ts is not removed, TypeScript will catch the error at compile time. The bun run typecheck step in the validation pipeline prevents this from reaching production.
- **Command group index.ts confused with barrels** — The index.ts files in command group directories (e.g., src/commands/adr/index.ts) contain real composition logic, not re-exports. ARCH-004 No Barrel Files explicitly permits index.ts files with logic.
- **Top-level await regression** — A developer unfamiliar with the --bytecode constraint may introduce top-level await back into src/cli.ts. Mitigation: The bun run build:check step in the validate pipeline catches this immediately — bun run validate will fail locally before the code reaches CI.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** ARCH-001/register-function-export: Scans all command files under src/commands/ (excluding index.ts group files) and verifies each exports a register*Command function. Severity: error.
- **Archgate rule** ARCH-001/no-business-logic: Detects complex data transformation patterns in command files that should be in helpers. Severity: error.
- **Build check** bun run build:check: Compiles src/cli.ts with bun build --compile --bytecode as part of bun run validate. A top-level await regression causes an immediate, descriptive parse error.

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
