---
id: ARCH-011
title: Consistent Project Root Resolution
domain: architecture
rules: true
files: ["src/commands/**/*.ts"]
---

# Consistent Project Root Resolution

## Context

Commands that operate on project-level resources (ADRs, rules, `.archgate/` config) need to locate the project root directory. Inconsistent strategies for finding the project root cause different behavior depending on the user's working directory:

- Commands using `findProjectRoot()` (walks up from cwd to find `.archgate/adrs/`) work correctly from any subdirectory
- Commands using `process.cwd()` directly fail when the user is in a subdirectory because they assume cwd IS the project root

This inconsistency was discovered during a repository-wide consistency review where `archgate check` worked from subdirectories but `archgate adr list` did not.

**Alternatives considered:**

- **Always use `process.cwd()`** — Simplest, but breaks when the user is in a subdirectory of the project. This is a common workflow (e.g., running `archgate adr list` while editing files in `src/`).
- **Require users to run from the project root** — Adds friction and goes against CLI conventions (git, npm, etc. all resolve upward).
- **Walk up from cwd to find `.archgate/adrs/`** — Standard convention used by git, npm, and other project-aware CLIs. Already implemented as `findProjectRoot()` in `src/helpers/paths.ts`.

## Decision

All commands that operate on `.archgate/` project resources MUST use `findProjectRoot()` from `src/helpers/paths.ts` to locate the project root. Direct use of `process.cwd()` for project root resolution in command files is prohibited.

**Exceptions:**

- `archgate init` — Creates the `.archgate/` directory; uses `process.cwd()` because no project root exists yet
- `archgate upgrade` — Operates on the binary, not on a project; its `findPackageRoot()` walks up from the binary path to find `package.json` for local install detection (a different concern than project root)
- Commands that don't require a project (e.g., `clean`, `login`) are not affected

## Do's and Don'ts

### Do

- Use `findProjectRoot()` from `src/helpers/paths.ts` in all commands that read from `.archgate/`
- Check the return value for `null` and exit with a helpful error message
- Pass the resolved `projectRoot` to `projectPaths()` for derived paths

### Don't

- Don't use `process.cwd()` to locate `.archgate/` in command files (except `init`)
- Don't define local `findProjectRoot()` variants — use the shared implementation
- Don't assume the user is running from the project root

## Consequences

### Positive

- All commands work consistently regardless of the user's working directory
- Matches user expectations from git, npm, and other project-aware CLIs

### Negative

- Slightly more verbose command setup (null check on `findProjectRoot()`)

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-011/no-process-cwd-for-project-root`: Scans command files for `process.cwd()` usage and flags violations. The `init` command is exempt. Severity: `error`.

### Manual Enforcement

Code reviewers MUST verify that new commands use `findProjectRoot()` for project-aware operations.

## References

- [ARCH-001 — Command Structure](./ARCH-001-command-structure.md) — Commands handle I/O only
- [ARCH-002 — Error Handling](./ARCH-002-error-handling.md) — Exit with code 1 when project not found
