---
id: ARCH-008
title: Typed Command Options
domain: architecture
rules: true
files: ["src/commands/**/*.ts"]
---

## Context

Commander.js `.option()` accepts arbitrary strings and produces loosely typed option values. This causes two problems:

1. **Fixed choices** — When a command accepts a fixed set of values (e.g., `--editor claude|cursor|vscode|copilot`), using `.option()` requires manual runtime validation and `as` casts to narrow the type — boilerplate that is easy to forget and produces unhelpful error messages.
2. **Custom parsers** — Passing a parser function (e.g., `parseInt`) as the third argument to `.option()` loses type information. The `opts` object infers `string` instead of the parser's return type. Worse, passing `parseInt` directly is a subtle bug: Commander passes `(value, previous)` but `parseInt` interprets `previous` as `radix`.

**Alternatives considered:**

- **Plain `.option()` with manual validation** — The developer writes a runtime check (`if (!VALID.includes(val))`) and casts to the narrow type. This works but scatters validation logic, produces inconsistent error messages across commands, and the `opts` object remains typed as `string`, requiring `as` casts at every usage site.
- **Zod/custom parsing in `.option()` argParser** — Commander supports a custom parse function as the third argument to `.option()`. While this gives runtime validation, it does not narrow the TypeScript type in the `opts` object when using `@commander-js/extra-typings`.

The `@commander-js/extra-typings` package provides the `Option` class with `.choices()` for enum-like options and `.argParser()` for custom parsers. Both methods correctly narrow the TypeScript type in the action callback's `opts` parameter. Using `.addOption()` instead of `.option()` integrates these typed options into the command.

## Decision

Options that require type narrowing beyond plain strings MUST use `new Option()` with `.addOption()` instead of plain `.option()`.

**Key constraints:**

1. **Use `Option` from `@commander-js/extra-typings`** — Import `Option` alongside `Command` from the extra-typings package to get full type inference.
2. **Use `.choices()` for enum-like options** — Any option accepting a fixed set of values must use `.choices()` to get both runtime validation and compile-time type narrowing.
3. **Use `.argParser()` for custom parsers** — Any option requiring type conversion (e.g., string to number) must use `.argParser()` on an `Option` object, not pass a parser function as the third argument to `.option()`.
4. **Use `.addOption()` to register** — The typed `Option` object is passed via `.addOption()`, not `.option()`.
5. **Use `as const` with `.choices()` and `.default()`** — Pass the choices array and default value with `as const` to preserve literal types.
6. **No manual validation for choice options** — Commander handles invalid value rejection automatically; do not duplicate this logic.

## Do's and Don'ts

### Do

- Use `new Option().choices([...] as const).default(... as const)` for fixed-choice options
- Use `new Option().argParser((val) => ...)` for options that need type conversion
- Register typed options via `.addOption()`
- Reuse existing type definitions (e.g., `EditorTarget`) for `Record` keys and other type-level usage
- Access `opts.editor` directly in switch/case — TypeScript narrows the type

### Don't

- Don't use `.option()` for options with a known set of valid values
- Don't pass parser functions (e.g., `parseInt`) as the third argument to `.option()` — use `.argParser()` on an `Option` object instead
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

### Good Example (argParser)

```typescript
import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

const maxEntriesOption = new Option(
  "--max-entries <n>",
  "maximum entries to return"
).argParser((val) => parseInt(val, 10));

export function registerExampleCommand(program: Command) {
  program
    .command("example")
    .addOption(maxEntriesOption)
    .action(async (opts) => {
      // opts.maxEntries is typed as number | undefined
      const limit = opts.maxEntries ?? 200;
    });
}
```

### Bad Example (choices)

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

### Bad Example (argParser)

```typescript
// BAD: parseInt passed directly — previous value becomes radix, type is wrong
export function registerExampleCommand(program: Command) {
  program
    .command("example")
    .option("--max-entries <n>", "maximum entries", parseInt)
    .action(async (opts) => {
      // opts.maxEntries type is not correctly inferred as number
      // parseInt receives (value, previous) — previous becomes radix (bug)
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

- **Regression** — A developer unfamiliar with this ADR may use `.option()` with manual validation or a bare parser function. The automated rules catch both patterns at check time.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** ARCH-008/use-add-option-for-choices: Scans command files for `.option()` calls that include a hardcoded choices-like pattern and flags them for migration to `.addOption()` with `.choices()`. Severity: error.
- **Archgate rule** ARCH-008/use-add-option-for-arg-parser: Scans command files for `.option()` calls that pass a parser function (e.g., `parseInt`, `parseFloat`, or arrow functions) as the third argument, and flags them for migration to `new Option().argParser()` with `.addOption()`. Severity: error.

### Manual Enforcement

Code reviewers MUST verify:

1. New commands with fixed-choice options use `new Option().choices()` with `.addOption()`
2. New commands with custom parsers use `new Option().argParser()` with `.addOption()`
3. The choices array and default use `as const` for literal type preservation
4. No manual validation duplicates Commander's built-in choice rejection

## References

- [Commander.js Option documentation](https://github.com/tj/commander.js#options)
- [@commander-js/extra-typings](https://github.com/tj/commander.js/tree/master/typings) — Typed Commander.js wrapper
- [ARCH-001 — Command Structure](./ARCH-001-command-structure.md) — Parent command registration pattern
