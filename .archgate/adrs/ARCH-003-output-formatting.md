---
id: ARCH-003
title: Output Formatting
domain: architecture
rules: true
files: ["src/**/*.ts"]
---

## Context

CLI output must be readable for humans and parseable for machines: colored in terminals, plain in pipes, structured JSON for CI. The coloring solution must work with Bun, add no dependency, and expose one API across all commands.

**Alternatives considered:**

- **chalk** — Adds a production dependency (violating [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md)), churns through breaking majors, and its ESM migration broke consumers; `node:util`'s `styleText` covers the same ground.
- **kleur / picocolors** — Smaller than chalk, but still a production dependency for what Bun supports natively.
- **Raw ANSI escape codes** — Zero-dependency but error-prone: missed resets bleed color, the codes are unreadable, and they ignore `NO_COLOR` and TTY detection.
- **No color at all** — Simpler, but makes output harder to scan, especially compliance reports where violations, warnings, and info need visual distinction.

`node:util`'s `styleText()` is supported by Bun, needs no dependency, handles TTY detection and `NO_COLOR` automatically, and provides a clean API.

## Decision

**Key conventions:**

1. **Colors via `styleText` only** — All colored output uses `styleText(format, text)` from `node:util`; no raw ANSI codes or third-party color libraries. `format` takes one style or an array (`["red", "bold"]`).
2. **`--json` flag for machine-readable output** — Commands producing structured results (check, adr list) support `--json`: JSON to stdout, no colors, no decorative formatting.
3. **Auto-compact JSON for agent contexts** — When stdout is not a TTY and `CI` is unset the caller is likely an AI agent, so `--json`-capable commands auto-switch to compact (unindented) JSON to minimize tokens. Detection: `src/helpers/output.ts` (`isAgentContext()`, `formatJSON()`). Precedence: `--ci` flag → `--json` flag (pretty) → agent auto-detect (compact) → TTY (human-readable) → CI env (human-readable).
4. **No emoji** — Use text symbols and colors; emoji rendering is inconsistent across terminals, fonts, and CI log viewers.
5. **stdout for results, stderr for diagnostics** — Results to stdout; errors, warnings, and debug to stderr (`logError()`, `logWarn()`, `logDebug()`).
6. **Concise and scannable** — Use whitespace and alignment, not walls of text.
7. **Progressive disclosure for agent payloads** — Enumeration commands (`adr list`) MUST emit identity fields only: the minimum needed to identify a record and decide whether to fetch it. Single-record commands (`adr show`) emit it in full; agents drill down. Compaction (convention 3) scales a payload by a constant factor; field selection keeps output inline-readable as record count grows — past a size threshold agent harnesses spill tool results to a file, defeating the purpose of emitting JSON. Default: the fields the human table renders are the right JSON field set. Omission MUST be driven by having nothing to report, never by a pass/fail status: a record that reads as passing can still carry warnings the consumer needs.

## Do's and Don'ts

### Do

- **DO** use `styleText` from `node:util` for colors
- **DO** support a `--json` flag for machine-readable output
- **DO** use `formatJSON()` from `src/helpers/output.ts` for all JSON serialization in commands — it auto-detects agent context
- **DO** pass `forcePretty: true` to `formatJSON()` when the user explicitly passes `--json` (they expect pretty-printed output)
- **DO** use `isAgentContext()` from `src/helpers/output.ts` to decide whether auto-JSON applies in commands with both human-readable and JSON modes
- **DO** use `console.log()` for normal output to stdout and `logError()` for errors to stderr
- **DO** project records down to identity fields in enumeration commands — pair a lean `list` with a full-detail `show` so agents can drill down
- **DO** keep output concise and scannable
- **DO** respect the `NO_COLOR` environment variable (handled automatically by `styleText`)

### Don't

- **DON'T** use emoji in CLI output
- **DON'T** use raw ANSI escape codes or third-party color libraries (chalk, kleur, picocolors) — `styleText` covers both needs
- **DON'T** include colors in `--json` output
- **DON'T** output progress spinners without a TTY check
- **DON'T** use `JSON.stringify()` directly in command files — use `formatJSON()` so agent-context detection stays consistent
- **DON'T** serialize a parsed record verbatim just because it's in hand (`.map((a) => a.frontmatter)`) — project it to the fields the consumer actually needs
- **DON'T** decide what to omit from a projected payload from a status or summary field alone — severity and status are separate axes, so a record can read as passing while still carrying warnings or info the consumer MUST see. Filter on "has nothing to report" (`status !== "pass" || violations.length > 0`), never on `status !== "pass"`
- **DON'T** assume piped output means agent context when `CI` is set — CI runners have piped stdout but should get human-readable output

## Implementation Pattern

### Good Example

```typescript
import { styleText } from "node:util";

console.log(styleText("green", "All checks passed")); // single style
console.log(styleText(["red", "bold"], "error:")); // combined styles
```

```typescript
// Agent-aware JSON output — auto-compact for agents, pretty for humans
import { formatJSON, isAgentContext } from "../helpers/output";

const useJson = opts.json || isAgentContext();
if (opts.ci) {
  reportCI(results);
} else if (useJson) {
  // forcePretty=true when explicit --json, auto-detect otherwise
  console.log(formatJSON(results, opts.json ? true : undefined));
} else {
  reportConsole(results);
}

// Always-JSON commands (review-context, session-context): just call formatJSON
console.log(formatJSON(context));
```

```typescript
// src/helpers/log.ts — logging helpers use styleText internally
export function logError(...args: Parameters<typeof console.error>) {
  console.error(styleText(["red", "bold"], "error:"), ...args);
}
```

### Bad Example

```typescript
// BAD: raw ANSI escape codes — hard to read, easy to forget reset
console.log("\x1b[31mError: something failed\x1b[0m");

// BAD: emoji in CLI output — inconsistent rendering
console.log("All checks passed");

// BAD: third-party color library — unnecessary dependency
import chalk from "chalk";
console.log(chalk.red("Error"));

// BAD: colors in JSON output
if (opts.json) console.log(styleText("green", JSON.stringify(results)));

// BAD: raw JSON.stringify in command files — loses agent-context detection
console.log(JSON.stringify(results, null, 2));
// GOOD: console.log(formatJSON(results));
```

## Consequences

### Positive

- **Consistent, professional CLI appearance** — All commands share the same color and formatting conventions
- **Machine-readable output enables scripting** — `--json` lets CI systems and scripts consume structured results
- **Zero dependency on color libraries** — `node:util` is built in, eliminating supply chain risk from color utilities
- **Automatic `NO_COLOR` support** — `styleText` respects `NO_COLOR` with no additional code
- **Token-efficient agent output** — Auto-compact JSON cuts agent token usage by 30-50% with zero config: agents get it automatically because their stdout is piped (non-TTY)

### Negative

- **`styleText` API is less ergonomic than chalk** — Chalk's fluent API (`chalk.bold.red("text")`) reads more naturally than `styleText("red", text)`. Acceptable given the dependency savings.
- **Limited to `styleText` capabilities** — Nested styles and mixed-style template literals need multiple `styleText` calls. Adequate for CLI output, less convenient for complex layouts.
- **Projections must be maintained alongside the schema** — Emitting identity fields means a genuinely useful new field does not reach `--json` consumers until the projection is updated too. That is the intended trade-off: field growth becomes deliberate rather than automatic, and omitted data stays one `show` away.

### Risks

- **Bun `styleText` compatibility gaps** — Bun implements `node:util` but may lag Node.js on new `styleText` features or options.
  - **Mitigation:** The CLI uses basic styles (red, green, yellow, bold, dim) that are stable in both runtimes. Avoid experimental or newly added style formats.
- **TTY detection edge cases** — `styleText` disables colors for non-TTY output, but some CI environments (GitHub Actions) report as TTY and then log raw ANSI codes.
  - **Mitigation:** `--json` bypasses all color formatting. CI integrations should use `--json` or `--ci` for structured output.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-003/no-emoji-in-output`: Scans source files for emoji characters in string literals. Severity: `error`.
- **Archgate rule** `ARCH-003/use-style-text`: Detects raw ANSI escape code patterns (`\u001b[`, `\x1b[`, `\033[`) in source files. Severity: `error`.

### Manual Enforcement

Code reviewers MUST verify:

1. New commands support `--json` when they output structured data
2. No third-party color libraries are imported
3. Error messages go to stderr (via `logError()`), results go to stdout
4. Enumeration commands emit identity fields only, and every emitted field earns its place. Payload size is not statically checkable, so reviewers MUST sanity-check `--json` output against a realistic record count (dozens, not the two-ADR fixture) rather than trusting a small test project

## References

- [Node.js styleText documentation](https://nodejs.org/api/util.html#utilstyletextformat-text-options)
- [Bun node:util support](https://bun.sh/docs/runtime/nodejs-apis#node-util)
- [NO_COLOR convention](https://no-color.org/)
- [ARCH-002 — Error Handling](./ARCH-002-error-handling.md) — Defines stderr convention for error output
- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — Justifies avoiding chalk/kleur/picocolors
