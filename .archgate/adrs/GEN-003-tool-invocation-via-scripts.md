---
id: GEN-003
title: Tool Invocation via Package Scripts
domain: general
rules: true
---

# Tool Invocation via Package Scripts

## Context

Archgate repositories run different toolchains: the plugins repo formats with Prettier, the CLI repo with oxfmt; both lint with OxLint but under different flags (`oxlint src/` vs `oxlint --deny-warnings .`). Agents and contributors who invoke tools directly (`bunx prettier --write`, `bunx oxfmt --write`, `npx eslint`) must know which tool each repository uses, and routinely get it wrong.

Without a standardized invocation pattern:

- The wrong formatter reformats files, producing CI failures on every push
- Project-specific linter flags (e.g., `--deny-warnings` in the CLI repo but not the plugins repo) are bypassed
- Tool commands copy-pasted between projects introduce formatting differences that pass locally and fail in CI
- Each push-amend-force-push cycle adds CI latency before the real issue is identified
- Running individual tools skips steps that the `validate` script aggregates (lint, format, typecheck, test, build) in a project-specific order, giving false confidence

**Alternatives considered:**

- **Direct invocation with per-repo knowledge** — Requires a mental map of repository to tool, breaks when a project switches formatters, and fails silently: both formatters produce valid output, just different output.
- **Wrapper scripts in each repo** (`scripts/format.sh`) — Unnecessary indirection when `package.json` scripts already serve this purpose, and shell scripts are less portable across Windows and Unix.
- **`package.json` scripts as the sole invocation layer** — Every repository already defines `lint`, `format`, `format:check`, and `validate`, encapsulating the correct tool, flags, and targets. Chosen: simplest, most portable, most robust.

The plugins and CLI repositories are developed in parallel, often in the same session, so the cost of invoking the wrong formatter recurs on every context switch rather than being a one-time mistake.

## Decision

All linting, formatting, and validation MUST be invoked through `package.json` scripts, never by running tools directly. The canonical commands are `bun run lint`, `bun run format`, `bun run format:check`, and `bun run validate`. Direct invocation of formatting or linting binaries (`bunx prettier`, `bunx oxfmt`, `npx eslint`, `oxlint .`) is prohibited in agent workflows and discouraged for manual use.

**Scope**: This ADR governs how linting and formatting tools are invoked — not which tools are used. It applies to all repositories in the Archgate ecosystem, not just this one.

**Required scripts**: Every `package.json` that contains lintable or formattable source code MUST define at minimum:

| Script         | Purpose                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------- |
| `lint`         | Run the project's linter with project-specific flags                                      |
| `format`       | Run the project's formatter in write mode                                                 |
| `format:check` | Run the project's formatter in check mode (CI-safe)                                       |
| `validate`     | Run the full validation suite (lint + format:check + typecheck + test + any other checks) |

## Do's and Don'ts

### Do

- **DO** run `bun run lint` to lint — never invoke the linter binary directly
- **DO** run `bun run format` to format — never invoke the formatter binary directly
- **DO** run `bun run validate` before pushing or opening a PR — it runs the full project-specific validation suite
- **DO** run `bun run format:check` in CI and when verifying formatting without mutating files
- **DO** check `package.json` scripts when working in an unfamiliar repository to understand what tools and flags are configured
- **DO** define `lint`, `format`, `format:check`, and `validate` scripts in every `package.json` that contains source code

### Don't

- **DON'T** run `bunx prettier`, `bunx oxfmt`, `npx eslint`, or any linter/formatter binary directly — always use `bun run format` or `bun run lint`
- **DON'T** assume which formatter a repository uses — the `package.json` scripts abstract this; rely on the abstraction
- **DON'T** run individual validation steps when `bun run validate` is available — it ensures the correct order and complete coverage
- **DON'T** pass custom flags to linters or formatters outside of `package.json` — project-specific flags (e.g., `--deny-warnings`, target directories) are encoded in the scripts and MUST NOT be overridden ad hoc
- **DON'T** add new linting or formatting tools without defining corresponding `package.json` scripts for them

## Consequences

### Positive

- **Repository-agnostic workflow**: The same commands (`bun run format`, `bun run lint`) work in every repository regardless of the tools configured
- **Zero CI regressions from tool confusion**: The script abstraction selects the correct tool, so the wrong formatter can never be invoked
- **Single point of change**: Switching formatters changes only the `package.json` scripts — all invocation sites keep working
- **Flag consistency**: Project-specific flags (`--deny-warnings`, target directories, ignore patterns) are defined once and applied uniformly
- **Complete validation**: `bun run validate` runs all checks in the correct order, preventing the false confidence of a single check

### Negative

- **Indirection**: `bun run format` does not reveal whether it invokes Prettier, oxfmt, or another formatter without inspecting `package.json`
- **Script maintenance**: Every repository must maintain four scripts (`lint`, `format`, `format:check`, `validate`)

### Risks

- **Missing scripts in new repositories**: A new repository might omit the required scripts, pushing agents back to direct invocation. **Mitigation:** The `archgate init` scaffolding MUST include these scripts in the generated `package.json`, and code review MUST verify their presence in any new `package.json`.
- **Script divergence across repos**: `validate` may cover different steps per repo (e.g., some include `bun run build:check`). **Mitigation:** Acceptable — each repository's `validate` reflects its own needs. The invariant is that `bun run validate` always runs the _complete_ set of checks for that repository.

## Compliance and Enforcement

**Automated enforcement** (companion `GEN-003-tool-invocation-via-scripts.rules.ts`):

- **GEN-003/no-direct-lint-format-invocation**: Scans `.github/workflows/*` and `package.json` for `bunx`/`npx` invocations of lint/format tools (`prettier`, `oxfmt`, `oxlint`, `eslint`, `biome`). The only acceptable place for a direct tool binary is inside a `package.json` script body. Scope deliberately excludes Markdown so this ADR's own prohibited-example text is not self-flagged, and excludes non-lint tools so legitimate invocations like `bunx --bun astro` (docs build) remain allowed.
- **GEN-003/no-bare-bun-test-in-ci**: Scans `.github/workflows/*` for bare `bun test` (as opposed to `bun run test`). Bare `bun test` skips the script-level flags in `package.json` (e.g. `--timeout 60000`), which causes filesystem/subprocess tests to time out on slow runners.

The Archgate developer agent definition also mandates `bun run format`, `bun run lint`, `bun run test`, and `bun run validate` — never direct tool invocation.

**Manual enforcement**: Code reviewers MUST reject PRs that introduce direct tool invocations (e.g., `bunx prettier --write`, `npx oxlint`) in scripts, CI workflows, or documentation. The only acceptable place for direct tool invocation is inside the `package.json` scripts themselves.

**Exceptions**: No exceptions. If a tool must be invoked with non-standard flags for a one-off debugging session, that invocation MUST NOT be committed, pushed, or documented as a recommended workflow.

## References

- [ARCH-006: Dependency Policy](./ARCH-006-dependency-policy.md) — governs which dependencies are permitted; tools referenced by scripts must comply
- [GEN-001: Documentation Site](./GEN-001-documentation-site.md) — related general governance ADR
