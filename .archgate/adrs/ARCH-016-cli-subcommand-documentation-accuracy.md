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

[ARCH-015](./ARCH-015-cli-command-documentation-coverage.md) guarantees that every top-level CLI command has a corresponding `.mdx` reference page. However, it does not check whether **subcommands** are documented inside that page. A top-level command group like `adr` can gain new subcommands (`import`, `sync`) without ARCH-015 flagging anything, because `adr.mdx` already exists.

This gap caused real drift: `archgate adr import` and `archgate adr sync` shipped without being documented in `adr.mdx`, and the omission was only caught by manual audit.

**Drift surfaces:**

1. **Undocumented subcommands.** A new `src/commands/<parent>/<sub>.ts` file lands without a matching heading in `<parent>.mdx`.
2. **Orphan subcommand docs.** A subcommand is removed but its heading lingers in the parent `.mdx`, advertising a command that no longer exists.

**Alternatives considered:**

- **Full option/flag cross-check via AST parsing.** Parsing Commander.js `.option()` chains from TypeScript files and comparing against documented options in `.mdx` files. This provides the deepest accuracy but requires a TypeScript parser, is brittle against Commander API changes, and adds significant complexity to the rule. Option-level accuracy is better enforced through code review.
- **Auto-generating docs from `--help` output.** Eliminates all drift but loses the hand-written prose, examples, and troubleshooting sections that make the reference pages useful. Already rejected in ARCH-015.
- **Extending ARCH-015 directly.** The existing ADR is well-scoped to top-level command-to-page parity. Adding subcommand checks would mix two different granularities of enforcement in one rule. A separate ADR keeps the responsibilities clear and each rule focused.

**Cross-references:**

- [ARCH-015 -- CLI Command Documentation Coverage](./ARCH-015-cli-command-documentation-coverage.md) handles the top-level command-to-page check that this ADR complements.
- [ARCH-001 -- Command Structure](./ARCH-001-command-structure.md) defines the `src/commands/<parent>/<sub>.ts` convention the rule relies on.
- [GEN-001 -- Documentation Site](./GEN-001-documentation-site.md) establishes the docs site structure.

## Decision

Every subcommand file at `src/commands/<parent>/<sub>.ts` (excluding `index.ts` files and nested command groups) MUST have a corresponding heading in the parent command's reference page at `docs/src/content/docs/reference/cli/<parent>.mdx`. The heading MUST contain the text `archgate <parent> <sub>` (case-insensitive).

Conversely, every heading in a `.mdx` file that matches the pattern `archgate <parent> <sub>` MUST correspond to an actual subcommand file.

**Scope:**

- **Direct subcommands only.** Files at `src/commands/<parent>/<sub>.ts` where `<sub>` is not `index.ts`. Nested command groups (`src/commands/<parent>/<sub>/index.ts`) are treated as subcommands of `<parent>` with the name `<sub>`.
- **Deeply nested subcommands are excluded.** Files like `src/commands/adr/domain/add.ts` are subcommands of `adr domain`, not `adr`. The rule checks one level of nesting only: `<parent>/<sub>.ts` and `<parent>/<sub>/index.ts`.
- **EN docs only.** The pt-br mirror is enforced by GEN-002.
- **Website docs only.** The skill reference (`commands.md` in plugin directories) is in a separate repository and cannot be checked from this project. Its sync is a manual responsibility documented in the Do's section below.

## Do's and Don'ts

### Do

- **DO** add a `## archgate <parent> <sub>` heading to `<parent>.mdx` in the same PR that adds a new subcommand
- **DO** remove the heading from `<parent>.mdx` in the same PR that removes a subcommand
- **DO** update the skill reference `commands.md` (in the `archgate/plugins` repository) whenever you update the website docs -- the four copies across plugin directories must stay identical and in sync with the website
- **DO** document nested command groups (e.g. `adr domain`) as a heading within the parent page, with their sub-subcommands listed in a table underneath

### Don't

- **DON'T** create a separate `.mdx` file for subcommands (ARCH-015 already forbids this)
- **DON'T** use non-standard heading formats -- the rule matches `archgate <parent> <sub>` in heading text
- **DON'T** assume the skill reference updates itself -- it lives in a separate repo (`archgate/plugins`) and requires manual sync after every website docs change

## Consequences

### Positive

- **Subcommand discoverability guaranteed.** Every subcommand shipped in the CLI has documentation in the parent's reference page -- no more silent omissions like `adr import` and `adr sync`.
- **Orphan detection.** Documented subcommands that no longer exist in code are flagged automatically.
- **Composable with ARCH-015.** This ADR handles subcommand-level coverage; ARCH-015 handles page-level coverage. Together they guarantee every command at every level is documented.
- **Lightweight enforcement.** The rule reads directory listings and greps headings -- no AST parsing, no process spawning.

### Negative

- **Does not check option accuracy.** The rule verifies subcommand headings exist but not that the documented options/flags match the actual Commander definition. Option-level accuracy requires code review.
- **Does not enforce skill reference sync.** The `commands.md` files in the plugins repo are outside the rule's reach. Drift between the website docs and skill reference must be caught through review.

### Risks

- **Non-standard heading format bypasses the rule.** If a contributor documents a subcommand with a heading like `## Import ADRs` instead of `## archgate adr import`, the rule won't detect it. **Mitigation:** The Do's section specifies the required format, and the rule's fix suggestion includes the expected heading text.
- **Nested group misdetection.** A directory like `src/commands/adr/domain/` contains both `index.ts` (the group) and `add.ts`, `remove.ts`, `list.ts` (the sub-subcommands). The rule treats `domain` as a subcommand of `adr` (correctly) but does not recurse into `domain/`'s children. **Mitigation:** Deeply nested subcommands are rare and are covered by the parent group's documentation pattern (table inside the heading section).

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-016/subcommand-has-docs-heading`: For each subcommand file under `src/commands/`, verifies a matching heading exists in the parent's `.mdx` page. Also checks the reverse: headings in `.mdx` files that look like subcommand references must correspond to actual files. Severity: `error`. Runs as part of `bun run validate` via `archgate check`.

### Manual Enforcement

Code reviewers MUST verify:

1. New subcommands come with a heading in the parent `.mdx` in the same PR
2. Removed subcommands have their heading deleted in the same PR
3. The skill reference `commands.md` (in `archgate/plugins`) is updated to match

## References

- [ARCH-015 -- CLI Command Documentation Coverage](./ARCH-015-cli-command-documentation-coverage.md) -- Top-level command-to-page check
- [ARCH-001 -- Command Structure](./ARCH-001-command-structure.md) -- Command file layout convention
- [GEN-001 -- Documentation Site](./GEN-001-documentation-site.md) -- Docs site structure and URL scheme
