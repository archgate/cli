---
id: GEN-003
title: Tool Invocation via Package Scripts
domain: general
rules: false
---

# Tool Invocation via Package Scripts

## Context

### Problem Statement

AI agents and contributors working across multiple Archgate repositories encounter different toolchains: the plugins repo uses Prettier for formatting, while the CLI repo uses oxfmt. Both use OxLint for linting, but with different flags (`oxlint src/` vs `oxlint --deny-warnings .`). When agents invoke tools directly (e.g., `bunx prettier --write`, `bunx oxfmt --write`, `npx eslint`), they must know which tool each repository uses — and they routinely get it wrong, causing CI failures that require multiple push-fix-push cycles.

### Pain Points

Without a standardized invocation pattern:

- Agents run `bunx prettier --write` in a repository that uses oxfmt, reformatting files with the wrong tool and producing CI failures on every push
- Different repositories use different linter flags (e.g., `--deny-warnings` in the CLI repo but not in the plugins repo); invoking linters directly bypasses these project-specific configurations
- Contributors copy-paste tool commands from one project's documentation and use them in another, introducing subtle formatting differences that pass locally but fail in CI
- CI failures from wrong-tool invocations waste time: each push-amend-force-push cycle adds 2-5 minutes of CI latency before the real issue is identified
- The `validate` script aggregates lint, format, typecheck, test, and build checks in a project-specific order — running individual tools misses steps and gives false confidence

### Alternatives Analysis

**Direct tool invocation with per-repo knowledge**: Agents and contributors memorize which tool each repository uses and invoke it directly (`bunx prettier` here, `bunx oxfmt` there). This is fragile — it requires maintaining a mental mapping of repositories to tools, breaks when a project switches formatters, and fails silently when the wrong tool is used (both produce valid output, just different output).

**Wrapper scripts in each repo**: Each repository provides a `scripts/format.sh` or similar. This adds unnecessary indirection when `package.json` scripts already serve this purpose. Shell scripts are also less portable across Windows and Unix.

**Package.json scripts as the sole invocation layer**: Every repository already defines `lint`, `format`, `format:check`, and `validate` scripts in `package.json`. These scripts encapsulate the correct tool, flags, and targets. Agents and contributors run `bun run format` regardless of which formatter the project uses. This is the simplest, most portable, and most robust approach.

### Project-Specific Motivation

For the Archgate ecosystem, the plugins repository and the CLI repository are developed in parallel, often in the same coding session. An agent working on a VS Code extension feature may commit to the plugins repo (Prettier) and the CLI repo (oxfmt) within minutes of each other. The cost of invoking the wrong formatter is not a one-time mistake — it recurs every time an agent switches context between repositories. Standardizing on `bun run format` eliminates this entire class of errors.

## Decision

All linting, formatting, and validation MUST be invoked through `package.json` scripts, never by running tools directly. The canonical commands are `bun run lint`, `bun run format`, `bun run format:check`, and `bun run validate`. Direct invocation of formatting or linting binaries (`bunx prettier`, `bunx oxfmt`, `npx eslint`, `oxlint .`) is prohibited in agent workflows and discouraged for manual use.

**Scope**: This ADR governs how linting and formatting tools are invoked — not which tools are used. It applies to all repositories in the Archgate ecosystem, not just this one.

**Required scripts**: Every `package.json` that contains lintable or formattable source code MUST define at minimum:

| Script | Purpose |
|--------|---------|
| `lint` | Run the project's linter with project-specific flags |
| `format` | Run the project's formatter in write mode |
| `format:check` | Run the project's formatter in check mode (CI-safe) |
| `validate` | Run the full validation suite (lint + format:check + typecheck + test + any other checks) |

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

- **Repository-agnostic workflow**: Agents and contributors use the same commands (`bun run format`, `bun run lint`) in every repository, regardless of which specific tools are configured
- **Zero CI regressions from tool confusion**: The wrong formatter can never be invoked because the script abstraction selects the correct one automatically
- **Single point of change**: When a project switches formatters (e.g., from Prettier to oxfmt), only the `package.json` scripts change — all invocation sites continue working unchanged
- **Flag consistency**: Project-specific flags (`--deny-warnings`, target directories, ignore patterns) are defined once in `package.json` and applied uniformly
- **Complete validation**: `bun run validate` ensures all checks run in the correct order, preventing the false confidence of running only one check

### Negative

- **Indirection**: Contributors cannot see which tool is running without inspecting `package.json` — the command `bun run format` does not reveal whether it invokes Prettier, oxfmt, or another formatter
- **Script maintenance**: Every repository must maintain four scripts (`lint`, `format`, `format:check`, `validate`), adding a small amount of boilerplate to each `package.json`

### Risks

- **Missing scripts in new repositories**: A new Archgate repository might omit the required scripts, causing agents to fall back to direct invocation. **Mitigation:** The `archgate init` scaffolding MUST include these scripts in the generated `package.json`. Code review MUST verify their presence in any new `package.json` file.
- **Script divergence across repos**: The `validate` script may have different steps in different repos (e.g., some include `bun run build:check`, others don't), creating inconsistent validation depth. **Mitigation:** This is acceptable — each repository's `validate` script reflects its specific needs. The invariant is that `bun run validate` always runs the *complete* set of checks for that repository.

## Compliance and Enforcement

**Automated enforcement**: The Archgate developer agent definition (`agents/developer.md`) MUST instruct agents to use `bun run format`, `bun run lint`, and `bun run validate` — never direct tool invocation. Agent memory records reinforce this rule across sessions.

**Manual enforcement**: Code reviewers MUST reject PRs that introduce direct tool invocations (e.g., `bunx prettier --write`, `npx oxlint`) in scripts, CI workflows, or documentation. The only acceptable place for direct tool invocation is inside the `package.json` scripts themselves.

**Exceptions**: No exceptions. If a tool must be invoked with non-standard flags for a one-off debugging session, that invocation MUST NOT be committed, pushed, or documented as a recommended workflow.

## References

- [ARCH-006: Dependency Policy](./ARCH-006-dependency-policy.md) — governs which dependencies are permitted; tools referenced by scripts must comply
- [GEN-001: Documentation Site](./GEN-001-documentation-site.md) — related general governance ADR
