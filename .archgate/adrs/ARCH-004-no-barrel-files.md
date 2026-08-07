---
id: ARCH-004
title: No Barrel Files or Re-Exports
domain: architecture
rules: true
files: ["src/**/*.ts"]
---

# No Barrel Files or Re-Exports

## Context

Barrel files are `index.ts` files whose sole purpose is re-exporting symbols from sibling modules. They introduce four concrete problems:

1. **Circular dependency risk** — A barrel pulls all siblings into one module surface, so cycles (module A imports the barrel that re-exports module B, which imports A) hide behind the indirection layer.
2. **Hidden coupling** — Consumers cannot tell which concrete module provides a symbol. This obscures the real dependency graph and masks architectural drift: moving a function between source modules requires no import change when the barrel re-exports both.
3. **IDE confusion** — The same symbol is reachable from both the barrel (`../formats`) and the source module (`../formats/adr`), producing inconsistent import paths across the codebase.
4. **Grep-unfriendly navigation** — Symbol searches land on the barrel first, costing an extra hop to reach the real implementation.

**Alternatives considered:**

- **Barrels as "public API" facades** — Appropriate for npm packages with external consumers; Archgate CLI has none, so the facade adds indirection without value.
- **Barrels only at package boundaries** (e.g., `src/engine/index.ts`) — Still carries the circular dependency cost, plus the overhead of deciding which directories "deserve" one.
- **Path aliases** (e.g., `@engine/loader`) — Archgate uses Bun's native module resolution without `paths` ([ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md)), and `paths` configuration carries its own maintenance burden.

Every module here is internal and consumed only within this repository, so direct imports keep the dependency graph explicit and auditable; the extra path verbosity is a worthwhile trade. This refines [ARCH-001 — Command Structure](./ARCH-001-command-structure.md), which permits `index.ts` for command groups containing real logic: `index.ts` with logic is permitted, `index.ts` that only re-exports is forbidden.

## Decision

**Barrel files and re-exports are forbidden.** All imports MUST point directly to the module that defines the symbol.

This ADR covers all TypeScript source files under `src/`. It does not cover test files or configuration files.

A barrel file is defined as an `index.ts` file that:

- Contains **only** `export`, `export type`, or `import type` statements (re-exports)
- Has **no** function definitions, class definitions, variable declarations, or executable logic

A **re-export** is any `export { X } from "./other-module"` or `export type { X } from "./other-module"` statement in any file (not just `index.ts`). Re-exports create the same indirection problems as barrel files: hidden coupling, grep-unfriendly navigation, and obscured dependency graphs.

Files named `index.ts` that contain actual logic are **not** barrel files and are permitted. Examples of permitted `index.ts` files:

- `src/commands/adr/index.ts` — defines `registerAdrCommand()` with command group composition logic
- `src/commands/plugin/index.ts` — defines `registerPluginCommand()` with subcommand composition logic

## Do's and Don'ts

### Do

- **DO** import directly from the source module: `import { parseAdr } from "../formats/adr"`
- **DO** import from the specific submodule: `import { loadRuleAdrs } from "../engine/loader"`
- **DO** keep `index.ts` files that contain real logic (command group registration, tool composition, factory functions)
- **DO** update all import paths when a module file is renamed — direct imports make affected files easy to find via grep
- **DO** use explicit file names in import paths: `from "../engine/runner"` not `from "../engine"`

### Don't

- **DON'T** create `index.ts` files that only re-export symbols from sibling modules
- **DON'T** re-export symbols from other modules via `export { X } from "./other"` in any file — consumers must import directly from the defining module
- **DON'T** import from a directory path (e.g., `from "../formats"`) expecting implicit `index.ts` resolution
- **DON'T** use barrel files as a "public API" facade — this project has no external module consumers
- **DON'T** add re-export-only statements to an otherwise legitimate `index.ts` — keep composition logic and re-exports separate
- **DON'T** create `index.ts` files to "simplify" imports — the verbosity of direct imports is the feature, not a problem
- **DON'T** use a module as a "facade" that re-exports from multiple sources — each import should point to exactly one defining module

## Implementation Pattern

### Good Example

```typescript
// src/commands/check.ts — imports point directly to source modules
import { loadRuleAdrs } from "../engine/loader";
import { runChecks } from "../engine/runner";
import { reportConsole, reportJSON, getExitCode } from "../engine/reporter";
```

### Bad Example

```typescript
// src/engine/index.ts — FORBIDDEN: pure re-export barrel
export { loadRuleAdrs, type LoadedAdr } from "./loader";
export { runChecks, type CheckResult } from "./runner";
export { reportConsole, reportJSON, getExitCode } from "./reporter";

// src/commands/check.ts — imports from barrel (obscures real source)
import { loadRuleAdrs, runChecks, reportConsole } from "../engine/index";
```

### Permitted index.ts (contains real logic)

```typescript
// src/commands/adr/index.ts — PERMITTED: defines a function with composition logic
import type { Command } from "@commander-js/extra-typings";
import { registerAdrCreateCommand } from "./create";
import { registerAdrListCommand } from "./list";

export function registerAdrCommand(program: Command) {
  const adr = program.command("adr").description("Manage ADRs");
  registerAdrCreateCommand(adr);
  registerAdrListCommand(adr);
}
```

## Consequences

### Positive

- **Explicit dependency graph** — Every import points to its true source, easing navigation, refactoring, and cycle audits
- **No circular dependency risk from barrels** — Removing the re-export indirection eliminates an entire class of hard-to-debug cycle bugs
- **Faster IDE navigation** — Go-to-definition jumps straight to the source module
- **Simpler grep results** — Symbol searches find the real implementation without hops through barrels
- **Consistent import style** — One direct pattern everywhere; no ambiguity between barrel and source

### Negative

- **Longer import paths** — `../../formats/adr` is more verbose than `../../formats`.
- **More imports to update on file moves** — Renaming a source module forces every direct importer to update, though IDE refactoring or find-and-replace automates this.
- **Multiple import lines from same directory** — Needing `loader`, `runner`, and `reporter` from `engine/` costs three import lines instead of one barrel import.

### Risks

- **Barrel files reintroduced out of habit** — Contributors unfamiliar with this ADR may create new ones.
  - **Mitigation:** The companion rule `ARCH-004/no-barrel-files` runs in the `archgate check` pipeline and blocks CI, catching violations before merge.
- **IDE auto-import may suggest directory-level imports** — Some IDE configurations default to shorter paths resolved through implicit `index.ts`.
  - **Mitigation:** With no re-export-only `index.ts` files present, there is nothing for auto-import to resolve to except the source module.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-004/no-barrel-files`: Scans all `index.ts` files under `src/` and flags any that contain only re-exports with no executable logic. Runs as part of `bun run validate` and `archgate check`. Severity: `error` (hard blocker).

### Manual Enforcement

Code reviewers MUST verify:

1. No new `index.ts` files are introduced that only contain `export ... from` statements
2. All imports point to specific source modules, not directory paths
3. Existing `index.ts` files with logic do not have re-export-only lines added

### Exceptions

Exceptions to this rule require approval by the lead architect and MUST be documented as a separate ADR explaining why a barrel file is necessary for the specific case.

## References

- [ARCH-001 — Command Structure](./ARCH-001-command-structure.md) — Permits `index.ts` for command groups with subcommands (contains logic, unaffected by this ADR)
- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — Aligns with minimal-dependency philosophy; direct imports reduce hidden coupling
- [Speeding up the JavaScript ecosystem — Barrel files](https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/) — Performance analysis of barrel file costs in JavaScript tooling
- [TypeScript barrel file anti-pattern](https://tkdodo.eu/blog/please-stop-using-barrel-files) — Community analysis of barrel file problems
