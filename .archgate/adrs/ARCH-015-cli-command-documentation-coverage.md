---
id: ARCH-015
title: CLI Command Documentation Coverage
domain: architecture
rules: true
files:
  - "src/commands/**/*.ts"
  - "docs/src/content/docs/reference/cli/**/*.mdx"
---

## Context

The CLI reference docs under `docs/src/content/docs/reference/cli/` are the authoritative surface users consult when choosing or using a command. A missing docs page is a silent failure — the command works, the test suite passes, but users (and the LLM-facing [llms-full.txt](../../docs/public/llms-full.txt) artifact) cannot discover it.

Drift happens in two directions:

1. **Undocumented commands.** A new `register*Command(program)` call lands in [src/cli.ts](../../src/cli.ts) without a matching `.mdx` file.
2. **Orphan docs.** A command is removed but its docs page lingers, advertising a flag that no longer exists.

**Alternatives considered:**

- **Manual review only.** Relies on reviewers remembering to check both surfaces on every command change; it has failed in practice.
- **Auto-generate the docs from `--help` output.** Eliminates drift but loses the hand-written prose (examples, troubleshooting sections, tips) that distinguishes our reference pages from a flat flag dump.
- **A single monolithic `cli.mdx`.** Kills the per-command URL structure users link to and breaks Starlight's per-page search indexing.

An automated cross-check that pairs every top-level command with exactly one hand-written `.mdx` file preserves prose quality and catches drift mechanically.

**Cross-references:**

- [ARCH-001 — Command Structure](./ARCH-001-command-structure.md) defines the `src/commands/<name>.ts` / `src/commands/<name>/index.ts` convention the check relies on.
- [GEN-001 — Documentation Site](./GEN-001-documentation-site.md) establishes the docs site and the `reference/cli/` URL namespace.
- [GEN-002 — Documentation Internationalization](./GEN-002-docs-i18n.rules.ts) already enforces that every EN page has a pt-br mirror, so this ADR only needs to cross-check EN ↔ commands.

## Decision

Every top-level CLI command registered via `register*Command(program)` in [src/cli.ts](../../src/cli.ts) MUST have a corresponding reference page at `docs/src/content/docs/reference/cli/<name>.mdx`. Conversely, every `.mdx` file in that directory (except `index.mdx`) MUST correspond to a top-level command.

**Scope:**

- **Top-level commands only.** Subcommands (e.g. `adr create`, `adr domain add`) are documented inline within their parent command's `.mdx` file. They MUST NOT get their own top-level reference page (e.g. there is no `adr-create.mdx`).
- **EN only.** The pt-br mirror requirement is enforced by the `GEN-002/i18n-page-parity` rule — this ADR does not duplicate that check.
- **`index.mdx` is exempt.** It is the landing page for the `reference/cli/` section, not a command page.

Command names are derived from the [src/commands/](../../src/commands/) directory using the convention established in ARCH-001:

- `src/commands/<name>.ts` → command name `<name>` (e.g. `check.ts` → `check`)
- `src/commands/<name>/index.ts` → command group `<name>` (e.g. `adr/index.ts` → `adr`)

Nested subcommand files (`src/commands/adr/create.ts`, `src/commands/adr/domain/index.ts`, etc.) are NOT treated as top-level commands and contribute nothing to the expected docs set.

## Do's and Don'ts

### Do

- **DO** create `docs/src/content/docs/reference/cli/<name>.mdx` in the same PR that adds a new top-level command
- **DO** document subcommands inline within the parent command's `.mdx` file (e.g. `adr domain` subcommands live under a `## archgate adr domain` heading inside `adr.mdx`)
- **DO** delete the corresponding `.mdx` file in the same PR that removes a top-level command
- **DO** follow the existing `.mdx` structure: frontmatter (`title`, `description`), one-line intro, subcommand table where applicable, options table, examples, troubleshooting where applicable
- **DO** create a matching pt-br mirror at `docs/src/content/docs/pt-br/reference/cli/<name>.mdx` — the `GEN-002/i18n-page-parity` rule will flag its absence separately

### Don't

- **DON'T** create a separate `.mdx` file for each subcommand (no `adr-create.mdx`, no `login-status.mdx`)
- **DON'T** leave an orphan `.mdx` file after removing a command — delete it in the same PR
- **DON'T** document a command exclusively inline in another page (e.g. burying `telemetry` under `init.mdx`) — every top-level command gets its own file
- **DON'T** bypass the rule by renaming the command file without renaming the docs file — keep the stems aligned

## Consequences

### Positive

- **Discoverability guaranteed.** Every command shipped in the CLI has a dedicated, linkable reference page.
- **Orphan detection.** Docs pages that outlive their command are flagged automatically, keeping the reference section truthful.
- **Cheap to enforce.** The rule reads directory listings only — no AST parsing of `src/cli.ts`, no `--help` invocation, no cross-process work.
- **Aligns with existing conventions.** Piggybacks on the `src/commands/<name>.ts` / `src/commands/<name>/index.ts` pattern from ARCH-001 without introducing new metadata.
- **Composes with GEN-002.** This rule handles command↔EN-doc parity; GEN-002 handles EN↔pt-br parity. Together they guarantee every command has docs in every supported locale.

### Negative

- **Prose overhead on new commands.** Adding a top-level command requires writing a reference page, not just code + tests. Mitigated by the short, templated structure of existing `.mdx` files.
- **False negative for exotic layouts.** A command-registration pattern that bypasses both `src/commands/<name>.ts` and `src/commands/<name>/index.ts` is invisible to the rule. ARCH-001 forbids this, so the drift is caught there first.

### Risks

- **A rename splits command and docs.** Renaming `src/commands/old.ts` → `src/commands/new.ts` without renaming `old.mdx` → `new.mdx` triggers two violations (orphan + missing). **Mitigation:** the rule's `fix` suggestions recommend the rename, and `bun run validate` catches it before the PR lands.
- **Rule rejects a deliberately undocumented internal command.** An experimental command not ready for public docs is blocked at introduction. **Mitigation:** either (a) don't register it in `src/cli.ts` until it is user-facing, or (b) ship a stub `.mdx` marked "Experimental — subject to change". The rule intentionally has no shared exemption list; shipping a command undocumented should be deliberate and visible.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-015/cli-command-has-docs-page`: Enumerates top-level commands under `src/commands/` and `.mdx` pages under `docs/src/content/docs/reference/cli/`, then reports any mismatch in either direction (missing docs, orphan docs). Severity: `error`. Runs as part of `bun run validate` via `archgate check`.

### Manual Enforcement

Code reviewers MUST verify:

1. New top-level commands come with a reference page in the same PR
2. Removed commands have their reference page deleted in the same PR
3. Subcommand documentation is folded into the parent `.mdx`, not a new file
4. pt-br mirrors accompany EN changes (GEN-002 will fail the build otherwise, but reviewers should not rely on CI alone)

## References

- [ARCH-001 — Command Structure](./ARCH-001-command-structure.md) — Command registration convention the rule relies on
- [GEN-001 — Documentation Site](./GEN-001-documentation-site.md) — Overall docs site structure and URL scheme
- [GEN-002 — Documentation Internationalization](./GEN-002-docs-i18n.rules.ts) — EN↔pt-br parity enforcement, composes with this ADR
