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

1. **Misleading provenance** — `process.env` reads as Node.js semantics and sends developers to Node.js documentation. `Bun.env` behaves identically at runtime (both return `string | undefined` per key) but makes the runtime dependency explicit.
2. **Inconsistent codebase style** — A mix of both accessors creates confusion about which is canonical; new contributors copy whichever pattern they encounter first.
3. **Alignment with project philosophy** — [ARCH-006 (Dependency Policy)](./ARCH-006-dependency-policy.md) establishes a "prefer Bun built-ins" principle. Environment variable access is no different.

**Alternatives considered:**

- **Continue using `process.env`** — Most familiar to developers with a Node.js background, but obscures the Bun-native nature of the project and creates style inconsistency as new code adopts `Bun.env`.
- **Wrapper helper (e.g., `getEnv()`)** — Adds indirection for no practical benefit. `Bun.env` is already a clean, well-typed API; wrapping it would violate the project's minimal-abstraction philosophy.
- **Allow both interchangeably** — Perpetuates the inconsistency that prompted this decision. A single canonical accessor is easier to enforce and review.

The CLI entry point already validates `typeof Bun !== "undefined"` and rejects non-Bun runtimes, so every source file in `src/` can safely assume Bun is available.

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
- **DO** use `Boolean(Bun.env.CI)` for truthy checks on environment flags — but only inline, as one operand of a larger `&&`/`||` expression, or assigned to a `const` first. `Boolean(x)` used as the _sole, direct_ condition of `if (...)`/`cond ? a : b`/`!x` trips `eslint(no-extra-boolean-cast)` ("redundant Boolean call"), since that position is already boolean-coerced — assign to a `const` first (see Implementation Pattern) or use an explicit `!== undefined && !== ""` comparison instead
- **DO** keep `process.env` in test files (`tests/`) where test harness compatibility is needed
- **DO** normalize a value through `usableEnv()` (`src/helpers/paths.ts`) before using it as a lookup key, path segment, or identifier — it maps both `""` and the literal string `"undefined"`, which shells and tooling surface for an unset variable, to `null`

### Don't

- **DON'T** use `process.env` in any file under `src/` — use `Bun.env` instead
- **DON'T** create wrapper functions around `Bun.env` — access it directly. `usableEnv()` is not such a wrapper: it validates a value already read from `Bun.env`, and performs no lookup of its own
- **DON'T** default an env value to an empty string (`Bun.env.FOO ?? ""`) when the consumer distinguishes "absent" from "supplied" — `""` reads as absent at the far end, so a rejected value becomes indistinguishable from an unset one and the failure surfaces as silently wrong behavior rather than an error
- **DON'T** destructure `Bun.env` (e.g., `const { HOME } = Bun.env`) — the proxy-based implementation may not support it reliably across versions; access properties individually

## Implementation Pattern

### Good Example

```typescript
// src/helpers/paths.ts — reading env vars with a default
const home = Bun.env.HOME ?? Bun.env.USERPROFILE ?? homedir();

// src/helpers/output.ts — truthy check on a flag
export function isAgentContext(): boolean {
  return !process.stdout.isTTY && !Bun.env.CI;
}

// src/helpers/log.ts — Boolean() as the SOLE if-condition needs a const
// first, or it trips eslint(no-extra-boolean-cast) (the position is
// already boolean-coerced)
const debugEnvFlag = Boolean(Bun.env.DEBUG);
if (debugEnvFlag) {
  console.warn("debug mode");
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

- **Unfamiliar to Node.js developers** — Contributors with a Node.js background instinctively reach for `process.env`. The linting rule provides immediate feedback.
- **Test/source divergence** — Tests use `process.env` while source uses `Bun.env`. Intentional, but may confuse contributors unfamiliar with the distinction.

### Risks

- **Bun.env behavioral differences** — `Bun.env` is a Proxy object, so edge cases (e.g., `Object.keys()`, `JSON.stringify()`, spread) may behave differently.
  - **Mitigation:** The CLI accesses env vars by name (`Bun.env.FOO`), never iterating or serializing the whole env object.
- **Contributors bypass the rule** — New contributors may use `process.env` out of habit.
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
