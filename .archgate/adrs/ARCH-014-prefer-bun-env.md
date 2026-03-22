---
id: ARCH-014
title: Prefer Bun.env over process.env
domain: architecture
rules: true
files:
  - "src/**/*.ts"
---

## Context

The CLI runs exclusively on Bun (`>=1.2.21`), never on Node.js. Bun provides `Bun.env` as its native environment variable accessor, while `process.env` is a Node.js compatibility shim that Bun maintains for backward compatibility.

Using `process.env` in a Bun-only codebase has several drawbacks:

1. **Type inconsistency** — `process.env` returns `string | undefined` for every key, requiring manual type narrowing. `Bun.env` behaves identically at runtime but signals intent: this code is Bun-native, not a Node.js port.
2. **Misleading provenance** — When a developer reads `process.env`, they assume Node.js semantics and may reach for Node.js documentation. `Bun.env` makes the runtime dependency explicit.
3. **Inconsistent codebase style** — A mix of `process.env` and `Bun.env` across files creates confusion about which accessor is canonical. New contributors copy whichever pattern they encounter first.
4. **Alignment with project philosophy** — [ARCH-006 (Dependency Policy)](./ARCH-006-dependency-policy.md) establishes a "prefer Bun built-ins" principle. Environment variable access is no different: Bun provides a native API, and the CLI should use it consistently.

**Alternatives considered:**

- **Continue using `process.env`** — The most familiar option for developers with Node.js background. However, it obscures the Bun-native nature of the project and creates style inconsistency as new code adopts `Bun.env`.
- **Wrapper helper (e.g., `getEnv()`)** — Centralizing env access through a helper would add indirection for no practical benefit. `Bun.env` is already a clean, well-typed API — wrapping it would violate the project's minimal-abstraction philosophy.
- **Allow both interchangeably** — Permitting both `process.env` and `Bun.env` would perpetuate the inconsistency that prompted this decision. A single canonical accessor is easier to enforce and review.

For Archgate, the CLI entry point already validates `typeof Bun !== "undefined"` and rejects non-Bun runtimes. Every source file in `src/` can safely assume Bun is available, making `Bun.env` the natural choice.

## Decision

All environment variable access in `src/` MUST use `Bun.env` instead of `process.env`. The `process.env` object MUST NOT be used in source files.

**Scope:** This ADR covers all TypeScript source files under `src/`. It does NOT cover:

- Test files (`tests/**/*.ts`) — tests may use `process.env` for setup/teardown (e.g., overriding `HOME`) since test harness compatibility matters
- Build scripts and configuration files outside `src/`
- Third-party code in `node_modules/`

**Key constraints:**

1. **`Bun.env` for all env reads** — Replace `process.env.FOO` with `Bun.env.FOO` everywhere in `src/`
2. **`Bun.env` for all env writes** — Replace `process.env.FOO = "bar"` with `Bun.env.FOO = "bar"` (Bun.env is writable)
3. **No `process.env` references** — Not even in comments that suggest using it (e.g., "// Use process.env.DEBUG to enable")

## Do's and Don'ts

### Do

- **DO** use `Bun.env.FOO` to read environment variables in all source files under `src/`
- **DO** use `Bun.env.FOO = "value"` to set environment variables when needed
- **DO** use nullish coalescing for defaults: `Bun.env.NODE_ENV ?? "production"`
- **DO** use `Boolean(Bun.env.CI)` for truthy checks on environment flags
- **DO** keep `process.env` in test files (`tests/`) where test harness compatibility is needed

### Don't

- **DON'T** use `process.env` in any file under `src/` — use `Bun.env` instead
- **DON'T** create wrapper functions around `Bun.env` — access it directly
- **DON'T** destructure `Bun.env` (e.g., `const { HOME } = Bun.env`) — the proxy-based implementation may not support it reliably across versions; access properties individually

## Implementation Pattern

### Good Example

```typescript
// src/helpers/paths.ts — reading env vars
const home = Bun.env.HOME ?? Bun.env.USERPROFILE ?? homedir();

// src/helpers/output.ts — checking CI flag
export function isAgentContext(): boolean {
  return !process.stdout.isTTY && !Bun.env.CI;
}

// src/helpers/log.ts — debug flag
export function logDebug(...args: Parameters<typeof console.debug>) {
  if (Bun.env.DEBUG) {
    console.warn(header, ...args);
  }
}
```

### Bad Example

```typescript
// BAD: using process.env in source files
const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();

// BAD: mixing process.env and Bun.env in the same file
const debug = process.env.DEBUG;
const ci = Bun.env.CI;
```

## Consequences

### Positive

- **Consistent codebase style** — A single canonical env accessor eliminates style debates and makes grep/search reliable
- **Clear runtime signal** — `Bun.env` immediately communicates that this code is Bun-native, not a Node.js port
- **Aligned with ARCH-006** — Follows the established "prefer Bun built-ins" principle for all APIs
- **Automated enforcement** — The companion rule catches violations in CI, preventing regression

### Negative

- **Unfamiliar to Node.js developers** — Contributors with Node.js background will instinctively reach for `process.env`. The linting rule provides immediate feedback.
- **Test/source divergence** — Tests use `process.env` while source uses `Bun.env`. This is intentional but may confuse contributors unfamiliar with the distinction.

### Risks

- **Bun.env behavioral differences** — `Bun.env` is a Proxy object, not a plain object like `process.env`. Edge cases (e.g., `Object.keys()`, `JSON.stringify()`, spread) may behave differently.
  - **Mitigation:** The CLI accesses env vars by name (`Bun.env.FOO`), never iterates or serializes the entire env object. This usage pattern is well-tested and stable.
- **Contributors bypass the rule** — New contributors may not know about `Bun.env` and use `process.env` out of habit.
  - **Mitigation:** The automated rule (`ARCH-014/no-process-env`) flags violations at check time. CI blocks merging non-compliant code.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-014/no-process-env`: Scans all source files under `src/` (excluding test files and `.archgate/`) for `process.env` usage and flags violations. Severity: `error`.

### Manual Enforcement

Code reviewers MUST verify:

1. New source files use `Bun.env` exclusively — no `process.env` references
2. Refactored code migrates `process.env` to `Bun.env` when touched

## References

- [Bun.env documentation](https://bun.sh/docs/runtime/env)
- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — Establishes the "prefer Bun built-ins" principle
- [ARCH-009 — Centralized Platform Detection](./ARCH-009-platform-detection-helper.md) — Similar pattern: centralizing a runtime API behind a project convention
