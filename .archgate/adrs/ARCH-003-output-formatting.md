---
id: ARCH-003
title: Output Formatting
domain: architecture
rules: true
files: ["src/**/*.ts"]
---

## Context

CLI output must be readable for humans and parseable for machines. Consistent formatting builds trust and enables automation — users expect colored output in terminals, plain text in pipes, and structured JSON for CI integration.

The CLI needs a coloring solution that works with Bun, has no external dependencies, and provides a consistent API across all commands.

**Alternatives considered:**

- **chalk** — The most popular terminal coloring library in the Node.js ecosystem. However, it adds a production dependency (violating [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md)), has gone through multiple breaking major versions, and its ESM migration caused widespread compatibility issues. The functionality it provides is fully covered by `node:util`'s `styleText`.
- **kleur / picocolors** — Lightweight alternatives to chalk. While smaller, they still add a production dependency for functionality that Bun already supports natively through `node:util`.
- **Raw ANSI escape codes** — Direct ANSI codes (e.g., `\x1b[31m`) are zero-dependency but error-prone: forgetting to reset codes causes color bleed, and the codes are unreadable. They also don't respect `NO_COLOR` or TTY detection.
- **No color at all** — Some CLIs avoid color entirely for simplicity. This makes output harder to scan, especially for compliance reports where violations, warnings, and info messages need visual distinction.

`node:util`'s `styleText()` is supported by Bun, requires no dependencies, handles TTY detection and `NO_COLOR` automatically, and provides a clean API. It is the right choice for this project.

## Decision

Use `styleText` from `node:util` for all terminal colors and formatting. Support `--json` flag on commands that output structured data. Auto-detect agent contexts and emit compact JSON to reduce token usage. No emoji in CLI output.

**Key conventions:**

1. **Colors via `styleText` only** — All colored output uses `styleText(format, text)` from `node:util`. No raw ANSI codes, no third-party color libraries. The `format` parameter accepts a single style string (e.g., `"red"`) or an array of styles (e.g., `["red", "bold"]`).
2. **`--json` flag for machine-readable output** — Commands that produce structured results (check, adr list) support `--json` to emit JSON to stdout. JSON output has no colors, no decorative formatting.
3. **Auto-compact JSON for agent contexts** — When stdout is not a TTY and the `CI` environment variable is not set, the CLI is likely being invoked by an AI agent. In this case, commands that support `--json` auto-switch to compact JSON output (no indentation/whitespace) to minimize token usage. The detection logic lives in `src/helpers/output.ts` via `isAgentContext()` and `formatJSON()`. The precedence order is: `--ci` flag → `--json` flag (pretty) → agent auto-detect (compact) → TTY (human-readable) → CI env (human-readable).
4. **No emoji** — CLI output uses text symbols and colors for visual distinction. Emoji rendering is inconsistent across terminals, fonts, and CI log viewers.
5. **stdout for results, stderr for diagnostics** — Normal command output goes to stdout. Errors, warnings, and debug messages go to stderr (via `logError()`, `logWarn()`, `logDebug()`).
6. **Concise and scannable** — Output should be scannable at a glance. Use whitespace and alignment, not walls of text.

## Do's and Don'ts

### Do

- Use `styleText` from `node:util` for colors
- Support `--json` flag for machine-readable output
- Use `formatJSON()` from `src/helpers/output.ts` for all JSON serialization in commands — it auto-detects agent context and formats accordingly
- Pass `forcePretty: true` to `formatJSON()` when the user explicitly passes `--json` (they expect pretty-printed output)
- Use `isAgentContext()` from `src/helpers/output.ts` to determine if auto-JSON should be enabled for commands that have both human-readable and JSON output modes
- Use `console.log()` for normal output to stdout, `logError()` for errors to stderr
- Keep output concise and scannable
- Respect `NO_COLOR` environment variable (handled automatically by `styleText`)

### Don't

- Don't use emoji in CLI output
- Don't use raw ANSI escape codes when `styleText` is available
- Don't include colors in `--json` output
- Don't output progress spinners without a TTY check
- Don't use third-party color libraries (chalk, kleur, picocolors)
- Don't use `JSON.stringify()` directly in command files — use `formatJSON()` so agent-context detection is consistent across all commands
- Don't assume piped output means agent context when `CI` env is set — CI runners have piped stdout but should get human-readable output

## Implementation Pattern

### Good Example

```typescript
import { styleText } from "node:util";

// Colored output for terminal — single style
console.log(styleText("green", "All checks passed"));
console.log(styleText("red", `Violation: ${message}`));
console.log(styleText("yellow", `Warning: ${message}`));

// Combined styles — pass an array of formats
console.log(styleText(["red", "bold"], "error:"));
```

```typescript
// Agent-aware JSON output — auto-compact for agents, pretty for humans
import { formatJSON, isAgentContext } from "../helpers/output";

// Commands with --json flag: auto-detect agent context
const useJson = opts.json || isAgentContext();
if (opts.ci) {
  reportCI(results);
} else if (useJson) {
  // forcePretty=true when explicit --json, auto-detect otherwise
  console.log(formatJSON(results, opts.json ? true : undefined));
} else {
  reportConsole(results);
}
```

```typescript
// Always-JSON commands (review-context, session-context): just use formatJSON
import { formatJSON } from "../helpers/output";

console.log(formatJSON(context)); // compact for agents, pretty for humans
```

```typescript
// Logging helpers use styleText internally
// src/helpers/log.ts
import { styleText } from "node:util";

export function logError(...args: Parameters<typeof console.error>) {
  console.error(styleText(["red", "bold"], "error:"), ...args);
}
export function logWarn(...args: Parameters<typeof console.warn>) {
  console.warn(styleText(["yellow", "bold"], "warn:"), ...args);
}
```

### Bad Example

```typescript
// BAD: raw ANSI escape codes — hard to read, easy to forget reset
console.log("\x1b[31mError: something failed\x1b[0m");

// BAD: emoji in CLI output — inconsistent rendering
console.log("All checks passed");
console.log("Violation found");

// BAD: third-party color library — unnecessary dependency
import chalk from "chalk";
console.log(chalk.red("Error"));

// BAD: colors in JSON output
if (opts.json) {
  console.log(styleText("green", JSON.stringify(results)));
}

// BAD: raw JSON.stringify in command files — loses agent-context detection
console.log(JSON.stringify(results, null, 2));
// GOOD: use formatJSON() instead
console.log(formatJSON(results));
```

## Consequences

### Positive

- **Consistent, professional CLI appearance** — All commands use the same color conventions and formatting style
- **Machine-readable output enables scripting** — `--json` flag lets CI systems and scripts consume structured results
- **Zero dependency on color libraries** — `node:util` is a built-in module, eliminating supply chain risk from color utilities
- **Automatic `NO_COLOR` support** — `styleText` respects the `NO_COLOR` environment variable without any additional code
- **Token-efficient agent output** — Auto-compact JSON in agent contexts reduces token usage by 30-50% without requiring agents to pass extra flags. Detection is zero-config: agents get compact JSON automatically because their stdout is piped (non-TTY)

### Negative

- **`styleText` API is less ergonomic than chalk** — Chalk's fluent API (`chalk.bold.red("text")`) reads more naturally than `styleText("red", text)`. The trade-off is acceptable given the dependency savings.
- **Limited to `styleText` capabilities** — Complex formatting (nested styles, template literals with mixed styles) requires multiple `styleText` calls. This is adequate for CLI output but less convenient than chalk for complex layouts.

### Risks

- **Bun `styleText` compatibility gaps** — Bun implements `node:util` but may lag behind Node.js for new `styleText` features or options. If a new format is added to Node.js `styleText`, Bun may not support it immediately.
  - **Mitigation:** The CLI uses basic styles (red, green, yellow, bold, dim) that have been stable in both Node.js and Bun. Avoid using experimental or newly added style formats.
- **TTY detection edge cases** — `styleText` automatically disables colors when output is not a TTY (piped output). However, some CI environments (GitHub Actions) report as TTY, which may produce colored output in logs that don't render ANSI codes.
  - **Mitigation:** The `--json` flag bypasses all color formatting. CI integrations should use `--json` or `--ci` flags for structured output.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-003/no-emoji-in-output`: Scans source files for emoji characters in string literals and flags violations. Severity: `error`.
- **Archgate rule** `ARCH-003/use-style-text`: Detects raw ANSI escape code patterns (`\u001b[`, `\x1b[`, `\033[`) in source files and flags violations. Severity: `error`.

### Manual Enforcement

Code reviewers MUST verify:

1. New commands support `--json` when they output structured data
2. No third-party color libraries are imported
3. Error messages go to stderr (via `logError()`), results go to stdout

## References

- [Node.js styleText documentation](https://nodejs.org/api/util.html#utilstyletextformat-text-options)
- [Bun node:util support](https://bun.sh/docs/runtime/nodejs-apis#node-util)
- [NO_COLOR convention](https://no-color.org/)
- [ARCH-002 — Error Handling](./ARCH-002-error-handling.md) — Defines stderr convention for error output
- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — Justifies avoiding chalk/kleur/picocolors
