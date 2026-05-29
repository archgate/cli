---
id: ARCH-018
title: Lazy-Load Heavy Dependencies
domain: architecture
rules: true
files: ["src/**/*.ts"]
---

# Lazy-Load Heavy Dependencies

## Context

The CLI is a single compiled binary whose entry point (`src/cli.ts`) statically imports every command's `register*Command` function so the help text and argument parser can be built. Static imports are evaluated eagerly: the moment `src/cli.ts` runs, the entire transitive import graph is parsed and executed — even for `archgate --help`, `archgate --version`, or any non-interactive command.

Several dependencies are large enough that parsing them dominates cold-start latency:

- **`inquirer`** (~200ms to parse) — only needed by interactive flows (`init`, `login`, `adr create`, `adr import`, `adr sync`, editor detection).
- **`posthog-node`** — only needed when telemetry is enabled and an event is actually sent.
- **`@sentry/node-core`** — only needed when error reporting initializes.

If these are imported statically at module load, every invocation pays their parse cost. For a CLI whose most common interactions are fast, non-interactive commands (and machine/agent invocations of `check`, `review-context`, `session-context`), that cost is pure waste.

### Alternatives Analysis

**Static imports everywhere (status quo for small deps)**: Simple, but forces every invocation to parse heavy modules it will never use. Rejected for heavy deps.

**Dynamic `import()` at the call site**: `const { default: inquirer } = await import("inquirer")` inside the function that needs it. The module is parsed only when that code path runs. This is the chosen approach.

**Eager-start / lazy-await for init-style work**: For SDKs that must initialize early but whose result is only needed later (Sentry, telemetry), start the async work before command registration and `await` it only at the first point of use (the `preAction` hook). This overlaps the cost with other startup work and skips it entirely for `--help`/`--version` which never reach `preAction`.

## Decision

Heavy dependencies MUST be loaded with dynamic `import()` at the point of use, never statically imported for their runtime value at module top level.

This applies to `inquirer`, `posthog-node`, `@sentry/*`, and any future dependency whose parse cost is significant and whose use is confined to specific code paths.

**Type-only imports are exempt.** `import type { PostHog } from "posthog-node"` and `import type * as SentryNs from "@sentry/node-core/light"` are erased at compile time and carry zero runtime cost — they are required for type safety and are allowed.

**Eager-start / lazy-await is permitted** for SDKs that must initialize early: start the init promise before command registration, then `await` it in the `preAction` hook so `--help`/`--version` skip it (see `src/cli.ts`, `initSentry()` + `initTelemetry()`).

## Do's and Don'ts

### Do

- **DO** load `inquirer` with `const { default: inquirer } = await import("inquirer")` inside the action handler or helper that prompts
- **DO** load `posthog-node` / `@sentry/*` SDK values with dynamic `import()` inside their init functions
- **DO** use `import type { ... }` for type-only references to these modules — it is free at runtime
- **DO** prefer eager-start + lazy-await (in `preAction`) for SDKs that need early initialization but whose result is consumed later

### Don't

- **DON'T** write `import inquirer from "inquirer"` (or any value import of a heavy module) at module top level
- **DON'T** statically `import { PostHog } from "posthog-node"` for its value — use `import type` plus a dynamic `import()`
- **DON'T** import heavy SDKs transitively through a statically-imported helper that runs at load time — keep the dynamic boundary at the SDK

## Consequences

### Positive

- **Fast cold start** for the common case: `--help`, `--version`, and non-interactive commands never parse interactive/telemetry/error SDKs
- **Agent-friendly**: machine invocations of `check`/`review-context` pay only for what they use
- **Localized cost**: each heavy module's parse time is attributed to the one code path that needs it

### Negative

- **Slight verbosity**: call sites use `await import()` instead of a top-of-file import
- **`await` required at the call site**: the consuming function must be async (already true for command actions)

### Risks

- **A new heavy dependency added with a static import**: silently reintroduces the cold-start tax. **Mitigation:** the companion rule flags value-level static imports of the known heavy modules; extend `HEAVY_MODULES` when adding a new one.

## Compliance and Enforcement

### Automated

- **Archgate rule** ARCH-018/no-static-heavy-import: Scans `src/**/*.ts` for value-level static imports of heavy modules (`inquirer`, `posthog-node`, `@sentry/*`). `import type` is allowed. Severity: error.

### Manual

Code reviewers MUST verify that any newly added large dependency is loaded via dynamic `import()` at its point of use, and that `HEAVY_MODULES` in the companion rule is updated to cover it.

## References

- [ARCH-001: Command Structure](./ARCH-001-command-structure.md) — `src/cli.ts` statically imports all command register functions; this ADR keeps their transitive heavy deps lazy
- [ARCH-006: Dependency Policy](./ARCH-006-dependency-policy.md) — governs which dependencies are permitted at all
- [ARCH-019: Interactive Prompts via withPromptFix](./ARCH-019-inquirer-prompt-fix.md) — companion rule for the `inquirer` usage this ADR keeps lazy
