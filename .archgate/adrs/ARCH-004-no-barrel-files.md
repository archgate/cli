---
id: ARCH-004
title: No Barrel Files
domain: architecture
rules: true
files: ["src/**/*.ts"]
---

# No Barrel Files

## Context

Barrel files are `index.ts` files whose sole purpose is re-exporting symbols from sibling modules. While common in TypeScript projects, they introduce several concrete problems:

1. **Circular dependency risk** — Barrel files pull all siblings into a single module surface, making it trivially easy to create accidental import cycles as modules grow. When module A imports from the barrel that also re-exports module B (which imports from module A), the cycle is hidden behind the indirection layer.
2. **Tree-shaking degradation** — Bundlers and runtimes must trace through re-export chains. Bun's module cache treats the barrel as a single unit, pulling in all symbols even when only one is needed, increasing memory footprint and startup time.
3. **Hidden coupling** — Consumers import from a barrel without knowing which concrete module provides a symbol. This obscures the real dependency graph and makes refactoring harder — moving a function between source modules requires no import changes if the barrel re-exports both, masking architectural drift.
4. **IDE confusion** — Auto-import suggestions become ambiguous when the same symbol is reachable from both the barrel (`../formats`) and the source module (`../formats/adr`). This leads to inconsistent import paths across the codebase, where some files import from the barrel and others from the source.
5. **Grep-unfriendly navigation** — Searching for the definition of a symbol leads to the barrel first, requiring an extra hop to find the real implementation. This slows down code review and debugging.

**Alternatives considered:**

- **Keep barrels as "public API" facades** — Some projects justify barrels as a way to define a module's public surface. This is appropriate for npm packages with external consumers, but Archgate CLI is a standalone application with no external module consumers. Every module is internal, so a "public API" layer adds indirection without value.
- **Use barrels only at package boundaries** — A middle-ground approach where barrels exist only at top-level directories (e.g., `src/engine/index.ts`). This reduces the proliferation problem but still carries the circular dependency and tree-shaking costs. The cognitive overhead of deciding which directories "deserve" a barrel is not worth the marginal convenience.
- **Use path aliases** — TypeScript path aliases (e.g., `@engine/loader`) can shorten import paths without introducing barrel files. However, Archgate uses Bun's native module resolution without path aliases ([ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md)), and adding `paths` configuration introduces its own maintenance burden.

For Archgate CLI, every module is internal and consumed only within the same repository. Direct imports make the dependency graph explicit and auditable. The small increase in import path verbosity (e.g., `../formats/adr` vs `../formats`) is a worthwhile trade for clarity.

This decision aligns with [ARCH-001 — Command Structure](./ARCH-001-command-structure.md), which already permits `index.ts` files for command groups that contain real logic (e.g., `src/commands/adr/index.ts` defines `registerAdrCommand()`). This ADR formalizes the distinction: `index.ts` files with logic are permitted; `index.ts` files that only re-export are forbidden.

## Decision

**Barrel files are forbidden.** All imports MUST point directly to the module that defines the symbol.

This ADR covers all TypeScript source files under `src/`. It does not cover test files or configuration files.

A barrel file is defined as an `index.ts` file that:

- Contains **only** `export`, `export type`, or `import type` statements (re-exports)
- Has **no** function definitions, class definitions, variable declarations, or executable logic

Files named `index.ts` that contain actual logic are **not** barrel files and are permitted. Examples of permitted `index.ts` files:

- `src/commands/adr/index.ts` — defines `registerAdrCommand()` with command group composition logic
- `src/commands/session-context/index.ts` — defines `registerSessionContextCommand()` with subcommand composition logic

## Do's and Don'ts

### Do

- **DO** import directly from the source module: `import { parseAdr } from "../formats/adr"`
- **DO** import from the specific submodule: `import { loadRuleAdrs } from "../engine/loader"`
- **DO** keep `index.ts` files that contain real logic (command group registration, tool composition, factory functions)
- **DO** update all import paths when a module file is renamed — direct imports make affected files easy to find via grep
- **DO** use explicit file names in import paths: `from "../engine/runner"` not `from "../engine"`

### Don't

- **DON'T** create `index.ts` files that only re-export symbols from sibling modules
- **DON'T** import from a directory path (e.g., `from "../formats"`) expecting implicit `index.ts` resolution
- **DON'T** use barrel files as a "public API" facade — this project has no external module consumers
- **DON'T** add re-export-only statements to an otherwise legitimate `index.ts` — keep composition logic and re-exports separate
- **DON'T** create `index.ts` files to "simplify" imports — the verbosity of direct imports is the feature, not a problem

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
import { registerAdrShowCommand } from "./show";

export function registerAdrCommand(program: Command) {
  const adr = program
    .command("adr")
    .description("Manage Architecture Decision Records");

  registerAdrCreateCommand(adr);
  registerAdrListCommand(adr);
  registerAdrShowCommand(adr);
}
```

## Consequences

### Positive

- **Explicit dependency graph** — Every import points to its true source, making the codebase easier to navigate, refactor, and audit for dependency cycles
- **No circular dependency risk from barrels** — Removing the re-export indirection eliminates an entire class of cycle bugs that are notoriously difficult to debug
- **Faster IDE navigation** — Go-to-definition jumps directly to the source module, not an intermediary re-export
- **Simpler grep results** — Searching for a symbol's definition finds the real implementation immediately, without extra hops through barrel files
- **Consistent import style** — All imports follow the same direct pattern, eliminating ambiguity about whether to import from a barrel or source module
- **Better tree-shaking** — Bun resolves only the specific module needed, without pulling in unrelated siblings through a shared barrel

### Negative

- **Longer import paths** — Imports like `../../formats/adr` are slightly more verbose than `../../formats`. This adds a few characters per import statement.
- **More imports to update on file moves** — When a source module is renamed, all direct importers must update their paths. However, this is straightforward to automate with IDE refactoring tools or global find-and-replace.
- **Multiple import lines from same directory** — When a file needs symbols from multiple sibling modules (e.g., `loader`, `runner`, and `reporter` from `engine/`), it requires separate import lines for each source module rather than a single barrel import.

### Risks

- **Existing barrel file violations may be reintroduced** — Contributors unfamiliar with this ADR might create new barrel files out of habit.
  - **Mitigation:** The companion automated rule (`ARCH-004/no-barrel-files`) runs in the `archgate check` pipeline and blocks CI. Violations are caught before merge.
- **IDE auto-import may suggest directory-level imports** — Some IDE configurations default to shorter import paths that resolve through implicit `index.ts`.
  - **Mitigation:** With barrel files deleted, there are no `index.ts` files to resolve to (except those with real logic). IDE auto-import will naturally point to the source module.

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
