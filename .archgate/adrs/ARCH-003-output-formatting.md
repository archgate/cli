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

1. **Colors via `styleText` only** — All colored output uses `styleText(format, text)` from `node:util`; no raw ANSI codes or third-party color libraries.
2. **Machine-readable output** — Commands with structured results support `--json` (`adr list`/`sync`/`import`) or, for `check`, `--output <format>` (convention 3). Both use `formatJSON()`: JSON to stdout, no colors, no decorative formatting.
3. **`--output <format>` on `check`** — `console` (default) | `json` | `github` (Actions annotations) | `sarif` (SARIF 2.1.0, for Code Scanning/Code Quality). Breaking change from `--json`/`--ci`; other commands unaffected. `--output` wins when given; omitted defaults to console, auto-upgrading to compact json in agent context. `github`/`sarif` are opt-in only, never auto-detected — the canonical pattern for future `check` formats.
4. **No emoji** — Use text symbols and colors; emoji rendering is inconsistent across terminals, fonts, and CI log viewers.
5. **stdout for results, stderr for diagnostics** — Results to stdout; errors, warnings, and debug to stderr (`logError()`, `logWarn()`, `logDebug()`).
6. **Concise and scannable** — Use whitespace and alignment, not walls of text.
7. **Progressive disclosure for agent payloads** — Enumeration commands (`adr list`) MUST emit identity fields only: the minimum needed to identify a record and decide whether to fetch it. Single-record commands (`adr show`) emit it in full; agents drill down. Compaction (`formatJSON()`, convention 2) scales a payload by a constant factor; field selection keeps output inline-readable as record count grows — past a size threshold agent harnesses spill tool results to a file, defeating the purpose of emitting JSON. Default: the fields the human table renders are the right JSON field set. Omission MUST be driven by having nothing to report, never by a pass/fail status: a record that reads as passing can still carry warnings the consumer needs.

## Do's and Don'ts

### Do

- **DO** use `styleText` from `node:util` for colors
- **DO** support `--output <format>` (or `--json` on simpler commands) for machine-readable output
- **DO** use `formatJSON()` from `src/helpers/output.ts` for all JSON serialization in commands — it auto-detects agent context
- **DO** pass `forcePretty: true` to `formatJSON()` when the user explicitly requests pretty JSON
- **DO** use `isAgentContext()` to decide whether auto-JSON applies in commands with both human-readable and JSON modes
- **DO** use `console.log()` for normal output to stdout and `logError()` for errors to stderr
- **DO** project records down to identity fields in enumeration commands — pair a lean `list` with a full-detail `show` so agents can drill down
- **DO** keep output concise and scannable
- **DO** respect the `NO_COLOR` environment variable (handled automatically by `styleText`)

### Don't

- **DON'T** use emoji in CLI output
- **DON'T** use raw ANSI escape codes or third-party color libraries (chalk, kleur, picocolors)
- **DON'T** include colors in `json`/`github`/`sarif` output
- **DON'T** auto-detect `github`/`sarif`; only `json` auto-upgrades
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
// check.ts: --output <format> selector (console/json/github/sarif) —
// wins outright when given; omitted defaults to console, auto-upgrading
// to compact json in agent context. github/sarif are opt-in only.
import { formatJSON, isAgentContext } from "../helpers/output";

const outputFormat = opts.output ?? (isAgentContext() ? "json" : "console");
if (outputFormat === "sarif") {
  reportSarif(result, summary);
} else if (outputFormat === "github") {
  reportCI(result, summary);
} else if (outputFormat === "json") {
  // forcePretty=true only for explicit --output json, auto-detect otherwise
  reportJSON(result, opts.output === "json" ? true : undefined, summary);
} else {
  reportConsole(result, verbose, summary);
}

// Plain --json flag on simpler commands (adr list/sync/import):
if (opts.json || isAgentContext()) {
  console.log(formatJSON(results, opts.json ? true : undefined));
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
- **Token-efficient agent output** — Auto-compact JSON removes indentation and whitespace from every agent-facing payload with zero config: agents get it automatically because their stdout is piped (non-TTY)

### Negative

- **`styleText` API is less ergonomic than chalk** — Chalk's fluent API (`chalk.bold.red("text")`) reads more naturally than `styleText("red", text)`. Acceptable given the dependency savings.
- **Limited to `styleText` capabilities** — Nested styles and mixed-style template literals need multiple `styleText` calls. Adequate for CLI output, less convenient for complex layouts.
- **Projections must be maintained alongside the schema** — Emitting identity fields means a genuinely useful new field does not reach `--json` consumers until the projection is updated too. That is the intended trade-off: field growth becomes deliberate rather than automatic, and omitted data stays one `show` away.

### Risks

- **Bun `styleText` compatibility gaps** — Bun implements `node:util` but may lag Node.js on new `styleText` features or options.
  - **Mitigation:** The CLI uses basic styles (red, green, yellow, bold, dim) that are stable in both runtimes. Avoid experimental or newly added style formats.
- **TTY detection edge cases** — `styleText` disables colors for non-TTY output, but some CI environments (GitHub Actions) report as TTY and then log raw ANSI codes.
  - **Mitigation:** `json`/`github`/`sarif` output bypasses all color formatting. CI integrations should use `--output json`/`github`/`sarif` (or `--json` on simpler commands) for structured output.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-003/no-emoji-in-output`: Scans source files for emoji characters in string literals. Severity: `error`.
- **Archgate rule** `ARCH-003/use-style-text`: Detects raw ANSI escape code patterns (`\u001b[`, `\x1b[`, `\033[`) in source files. Severity: `error`.

### Manual Enforcement

Code reviewers MUST verify:

1. New commands support `--output <format>` or `--json` when they output structured data
2. No third-party color libraries are imported
3. Error messages go to stderr (via `logError()`), results go to stdout
4. Enumeration commands emit identity fields only, and every emitted field earns its place. Payload size is not statically checkable, so reviewers MUST sanity-check `--json`/`--output json` output against a realistic record count (dozens, not the two-ADR fixture) rather than trusting a small test project
5. `check`'s `--json`/`--ci` → `--output <format>` migration is the reference precedent for any future flag-to-`--output`-style unification — a new machine-readable format on an existing command should extend `--output`'s choices, not add another boolean flag

## References

- [Node.js styleText documentation](https://nodejs.org/api/util.html#utilstyletextformat-text-options)
- [Bun node:util support](https://bun.sh/docs/runtime/nodejs-apis#node-util)
- [NO_COLOR convention](https://no-color.org/)
- [SARIF 2.1.0 specification](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) — schema `--output sarif` implements
- [GitHub Code Scanning SARIF support](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning) — consumer of `--output sarif`
- [ARCH-002 — Error Handling](./ARCH-002-error-handling.md) — Defines stderr convention for error output
- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — Justifies avoiding chalk/kleur/picocolors
