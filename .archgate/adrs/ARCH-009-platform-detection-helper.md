---
id: ARCH-009
title: Centralized Platform Detection
domain: architecture
rules: true
files:
  - "src/**/*.ts"
---

## Context

The Archgate CLI runs on macOS, Linux, and Windows (including WSL). Platform-specific behavior appears throughout the codebase: shell syntax in user-facing messages, path separators, subprocess resolution, and feature availability checks.

The `src/helpers/platform.ts` module already provides a centralized, cached API for platform detection (`isWindows()`, `isMacOS()`, `isLinux()`, `isWSL()`, `getPlatformInfo()`). It also exposes a `_resetPlatformCache()` function that allows tests to simulate different platforms without mocking `process.platform` directly.

The problem is that nothing prevents code from bypassing this module and reading `process.platform` directly. Direct reads:

- **Scatter platform logic** — Platform checks end up duplicated across modules with inconsistent patterns (`process.platform === "win32"` vs `process.platform !== "linux"`).
- **Cannot be tested** — `process.platform` is read-only in Bun. Code that reads it directly cannot be tested under a different platform without modifying global state. The platform helper's `_resetPlatformCache()` makes cross-platform testing straightforward.
- **Miss WSL** — `process.platform` returns `"linux"` inside WSL. Code that checks for `"win32"` to decide Windows-specific behavior will miss WSL scenarios where Windows paths or tools are relevant. The platform helper accounts for WSL.

## Decision

All platform detection in `src/` MUST go through `src/helpers/platform.ts`. Direct access to `process.platform` outside of `platform.ts` is **forbidden**.

This covers:

- OS-conditional logic (Windows vs macOS vs Linux)
- WSL detection
- Platform-specific user-facing messages (shell syntax, paths)
- Feature availability checks that depend on the OS

This does NOT cover:

- Test files (`tests/**/*.ts`) — tests may inspect `process.platform` for conditional assertions
- Build scripts and configuration files outside `src/`

## Do's and Don'ts

### Do

- **DO** import from `src/helpers/platform.ts` for any platform check: `isWindows()`, `isMacOS()`, `isLinux()`, `isWSL()`, `getPlatformInfo()`
- **DO** use `_resetPlatformCache()` in tests to simulate different platforms
- **DO** consider WSL when implementing Windows-specific behavior — `isWSL()` returns true when running Linux inside WSL, where Windows tools may still be relevant

### Don't

- **DON'T** read `process.platform` directly in source files — use the platform helper instead
- **DON'T** duplicate platform detection logic that already exists in `platform.ts`
- **DON'T** assume `"linux"` means a native Linux environment — it could be WSL

## Consequences

### Positive

- **Single source of truth** — All platform detection flows through one module with consistent caching and WSL awareness.
- **Testable** — Cross-platform behavior can be tested on any OS via `_resetPlatformCache()`.
- **WSL-safe** — The helper correctly distinguishes native Linux from WSL, preventing subtle bugs.

### Negative

- **Import overhead** — Modules that need a one-off platform check must import from `platform.ts` instead of reading `process.platform` directly.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-009/no-direct-process-platform`: Scans all TypeScript source files (excluding `platform.ts` itself and tests) for direct `process.platform` access. Severity: `error`.

### Manual Enforcement

Code reviewers MUST verify:

1. No `process.platform` reads appear outside `src/helpers/platform.ts`
2. Platform-conditional logic uses the helper functions, not inline checks
3. WSL is considered when the behavior differs between Linux and Windows

## References

- [ARCH-007 — Cross-Platform Subprocess Execution](./ARCH-007-cross-platform-subprocess-execution.md) — Related cross-platform concern for subprocess APIs
- `src/helpers/platform.ts` — The canonical platform detection module
