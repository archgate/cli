---
id: ARCH-016
title: CLI Subcommand Documentation Accuracy
domain: architecture
rules: true
files:
  - "src/commands/**/*.ts"
  - "docs/src/content/docs/reference/cli/**/*.mdx"
---

## Context

[ARCH-015](./ARCH-015-cli-command-documentation-coverage.md) guarantees that every top-level CLI command has a corresponding `.mdx` reference page, but it does not check whether **subcommands** are documented inside that page. A command group like `adr` can gain new subcommands without ARCH-015 flagging anything, because `adr.mdx` already exists — a gap that has produced real drift.

**Drift surfaces:**

1. **Undocumented subcommands.** A new `src/commands/<parent>/<sub>.ts` file lands without a matching heading in `<parent>.mdx`.
2. **Orphan subcommand docs.** A subcommand is removed but its heading lingers in the parent `.mdx`, advertising a command that no longer exists.

**Alternatives considered:**

- **Full option/flag cross-check via AST parsing.** Parsing Commander.js `.option()` chains and comparing against documented options gives the deepest accuracy, but requires a TypeScript parser, is brittle against Commander API changes, and adds significant rule complexity. Option-level accuracy is better enforced through code review.
- **Auto-generating docs from `--help` output.** Eliminates all drift but loses the hand-written prose, examples, and troubleshooting sections that make the reference pages useful. Already rejected in ARCH-015.
- **Extending ARCH-015 directly.** Adding subcommand checks to an ADR scoped to top-level command-to-page parity would mix two granularities of enforcement in one rule. A separate ADR keeps each rule focused.

**Cross-references:**

- [ARCH-015 -- CLI Command Documentation Coverage](./ARCH-015-cli-command-documentation-coverage.md) handles the top-level command-to-page check that this ADR complements.
- [ARCH-001 -- Command Structure](./ARCH-001-command-structure.md) defines the `src/commands/<parent>/<sub>.ts` convention the rule relies on.
- [GEN-001 -- Documentation Site](./GEN-001-documentation-site.md) establishes the docs site structure.

## Decision

Every subcommand module under `src/commands/<parent>/` — at any nesting depth — MUST have a corresponding heading in the top-level parent's reference page at `docs/src/content/docs/reference/cli/<parent>.mdx`. The heading MUST contain the full command path (e.g. `archgate adr domain add`), case-insensitive.

Conversely, every heading whose command path's parent chain consists of command-group directories MUST correspond to an actual subcommand module.

**Scope:**

- **Module-backed subcommands, at every depth.** A group is any directory with an `index.ts`; its subcommands are sibling `<sub>.ts` modules and child groups. `src/commands/adr/domain/add.ts` is the command `adr domain add` and needs that heading in `adr.mdx`.
- **In-module subcommands are manual territory.** Subcommands registered inside a single module (e.g. `session-context.ts` registering `list`/`show`) are invisible to file-layout discovery: their headings are permitted, not orphan-flagged, and their coverage rests on code review. A heading is orphan-checked only when every ancestor in its command path is a group directory, so a command whose parent is a plain module — or a top-level command with no directory at all — is exempt.
- **EN docs only.** The pt-br mirror is enforced by GEN-002.
- **Website docs only.** The skill reference (`commands.md` in plugin directories) is in a separate repository and cannot be checked from this project. Its sync is a manual responsibility documented in the Do's section below.

## Do's and Don'ts

### Do

- **DO** add a `## archgate <parent> <sub>` heading to `<parent>.mdx` in the same PR that adds a new subcommand
- **DO** remove the heading from `<parent>.mdx` in the same PR that removes a subcommand
- **DO** update the skill reference `commands.md` (in the `archgate/plugins` repository) whenever you update the website docs -- the four copies across plugin directories must stay identical and in sync with the website
- **DO** document nested command groups (e.g. `adr domain`) as a heading within the parent page, with each module-backed sub-subcommand under its own deeper heading (e.g. `### archgate adr domain add`)

### Don't

- **DON'T** create a separate `.mdx` file for subcommands (ARCH-015 already forbids this)
- **DON'T** use non-standard heading formats -- the rule matches `archgate <parent> <sub>` in heading text
- **DON'T** assume the skill reference updates itself -- it lives in a separate repo (`archgate/plugins`) and requires manual sync after every website docs change

## Consequences

### Positive

- **Subcommand discoverability guaranteed.** Every subcommand shipped in the CLI has documentation in the parent's reference page.
- **Orphan detection.** Documented subcommands that no longer exist in code are flagged automatically.
- **Composable with ARCH-015.** This ADR handles subcommand-level coverage; ARCH-015 handles page-level coverage. Together they guarantee every command at every level is documented.
- **Lightweight enforcement.** The rule reads directory listings and greps headings -- no AST parsing, no process spawning.

### Negative

- **Does not check option accuracy.** The rule verifies subcommand headings exist but not that documented options/flags match the actual Commander definition. Option-level accuracy requires code review.
- **Does not see in-module subcommands.** Discovery is file-layout-based, so subcommands a module registers internally (the `session-context` editor commands' `list`/`show`) are outside the guarantee and rest on code review.
- **Does not enforce skill reference sync.** The `commands.md` files in the plugins repo are outside the rule's reach. Drift between the website docs and skill reference must be caught through review.

### Risks

- **Non-standard heading format bypasses the rule.** A heading like `## Import ADRs` instead of `## archgate adr import` goes undetected. **Mitigation:** The Do's section specifies the required format, and the rule's fix suggestion includes the expected heading text.
- **Orphan detection is depth-limited by design.** A heading is orphan-flagged only when every ancestor in its command path is a group directory. A heading under a leaf module, or under a top-level command with no directory (e.g. `### archgate session-context list`), cannot be verified against the file layout, so a stale in-module subcommand heading survives the rule. **Mitigation:** reviewers check in-module subcommand docs when the registering module changes.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-016/subcommand-has-docs-heading`: For each subcommand module under `src/commands/`, at any nesting depth, verifies a matching full-command-path heading exists in the top-level parent's `.mdx` page, and the reverse — headings whose parent chain is made of group directories must correspond to actual modules. Severity: `error`. Runs as part of `bun run validate` via `archgate check`.

### Manual Enforcement

Code reviewers MUST verify:

1. New subcommands come with a heading in the parent `.mdx` in the same PR
2. Removed subcommands have their heading deleted in the same PR
3. The skill reference `commands.md` (in `archgate/plugins`) is updated to match

## References

- [ARCH-015 -- CLI Command Documentation Coverage](./ARCH-015-cli-command-documentation-coverage.md) -- Top-level command-to-page check
- [ARCH-001 -- Command Structure](./ARCH-001-command-structure.md) -- Command file layout convention
- [GEN-001 -- Documentation Site](./GEN-001-documentation-site.md) -- Docs site structure and URL scheme
