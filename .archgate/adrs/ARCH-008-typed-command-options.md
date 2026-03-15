---
id: ARCH-008
title: Typed Command Options
domain: architecture
rules: true
files: ["src/commands/**/*.ts"]
---

## Context

Commander.js `.option()` accepts arbitrary strings and produces loosely typed option values. When a command accepts a fixed set of choices (e.g., `--editor claude|cursor|vscode|copilot`), using `.option()` requires manual runtime validation and `as` casts to narrow the type — boilerplate that is easy to forget and produces unhelpful error messages when users pass invalid values.

**Alternatives considered:**

- **Plain `.option()` with manual validation** — The developer writes a runtime check (`if (!VALID.includes(val))`) and casts to the narrow type. This works but scatters validation logic, produces inconsistent error messages across commands, and the `opts` object remains typed as `string`, requiring `as` casts at every usage site.
- **Zod/custom parsing in `.option()` argParser** — Commander supports a custom parse function as the third argument to `.option()`. While this gives runtime validation, it does not narrow the TypeScript type in the `opts` object when using `@commander-js/extra-typings`.

The `@commander-js/extra-typings` package provides `Option` class with a `.choices()` method that both validates at runtime (Commander rejects invalid values with a clear error) and narrows the TypeScript type in the action callback's `opts` parameter. Using `.addOption()` instead of `.option()` integrates this typed option into the command.

## Decision

Commands with fixed-choice options MUST use `new Option().choices().default()` with `.addOption()` instead of plain `.option()` with manual validation.

**Key constraints:**

1. **Use `Option` from `@commander-js/extra-typings`** — Import `Option` alongside `Command` from the extra-typings package to get full type inference.
2. **Use `.choices()` for enum-like options** — Any option accepting a fixed set of values must use `.choices()` to get both runtime validation and compile-time type narrowing.
3. **Use `.addOption()` to register** — The typed `Option` object is passed via `.addOption()`, not `.option()`.
4. **Use `as const` with `.choices()` and `.default()`** — Pass the choices array and default value with `as const` to preserve literal types.
5. **No manual validation for choice options** — Commander handles invalid value rejection automatically; do not duplicate this logic.

## Do's and Don'ts

### Do

- Use `new Option().choices([...] as const).default(... as const)` for fixed-choice options
- Register typed options via `.addOption()`
- Reuse existing type definitions (e.g., `EditorTarget`) for `Record` keys and other type-level usage
- Access `opts.editor` directly in switch/case — TypeScript narrows the type

### Don't

- Don't use `.option()` for options with a known set of valid values
- Don't write manual `if (!VALID.includes(val))` checks for choice options — Commander does this
- Don't cast `opts.editor as SomeType` — the type should already be narrowed

## Implementation Pattern

### Good Example

```typescript
import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

const editorOption = new Option("--editor <editor>", "target editor")
  .choices(["claude", "cursor", "vscode", "copilot"] as const)
  .default("claude" as const);

export function registerExampleCommand(program: Command) {
  program
    .command("example")
    .addOption(editorOption)
    .action(async (opts) => {
      // opts.editor is typed as "claude" | "cursor" | "vscode" | "copilot"
      switch (opts.editor) {
        case "claude":
          break;
        case "cursor":
          break;
        // TypeScript enforces exhaustive matching
      }
    });
}
```

### Bad Example

```typescript
// BAD: loose typing, manual validation, casts
export function registerExampleCommand(program: Command) {
  program
    .command("example")
    .option("--editor <editor>", "target editor", "claude")
    .action(async (opts) => {
      // opts.editor is string — no narrowing
      if (!["claude", "cursor"].includes(opts.editor)) {
        logError(`Unknown editor "${opts.editor}"`);
        process.exit(1);
      }
      const editor = opts.editor as EditorTarget; // unsafe cast
    });
}
```

## Consequences

### Positive

- **Compile-time safety** — Invalid option values are caught by TypeScript, not just at runtime
- **Consistent error messages** — Commander produces standard error output for invalid choices
- **No boilerplate validation** — Eliminates repeated `if (!VALID.includes(...))` patterns
- **Exhaustive switch/case** — TypeScript ensures all choices are handled when switching on the option value

### Negative

- **Slightly more verbose declaration** — `new Option().choices().default()` with `.addOption()` is more code than `.option()` for simple cases. This is acceptable given the type safety gained.

### Risks

- **Inconsistency with existing commands** — Older commands (e.g., `init --editor`) still use `.option()` with manual validation. These should be migrated incrementally. The automated rule only scans for `.choices()` usage, not for migration of existing code.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** ARCH-008/use-add-option-for-choices: Scans command files for `.option()` calls that include a hardcoded choices-like pattern and flags them for migration to `.addOption()` with `.choices()`. Severity: warning.

### Manual Enforcement

Code reviewers MUST verify:

1. New commands with fixed-choice options use `new Option().choices()` with `.addOption()`
2. The choices array and default use `as const` for literal type preservation
3. No manual validation duplicates Commander's built-in choice rejection

## References

- [Commander.js Option documentation](https://github.com/tj/commander.js#options)
- [@commander-js/extra-typings](https://github.com/tj/commander.js/tree/master/typings) — Typed Commander.js wrapper
- [ARCH-001 — Command Structure](./ARCH-001-command-structure.md) — Parent command registration pattern
