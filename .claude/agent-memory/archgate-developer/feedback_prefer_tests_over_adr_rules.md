---
name: pick-the-right-enforcement-layer
description: Static syntactic invariants belong in a custom oxlint rule (.archgate/lint/oxlint.ts), not in ADR .rules.ts and not in tests
metadata:
  type: feedback
---

Pick the enforcement layer by the nature of the invariant — don't default to ADR rules.

**Why:** After the inquirer v14 `"list"` → `"select"` crash, a draft ADR `.rules.ts` allowlist rule and a bun test scanning source files were both rejected by the user (an untestable-in-CI check isn't a real test; a per-file syntax check isn't an ADR governance check). The draft rule was never assigned an ADR ID — it landed instead as a custom oxlint JS plugin rule (`archgate/valid-inquirer-prompt-type` in `.archgate/lint/oxlint.ts`) — real AST access, runs in the existing `bun run lint` gate.

**How to apply:**

- **Tests** verify _behavior_ — if the check can't actually execute the code path (e.g. interactive prompts with no TTY in CI), it is not a test, no matter where the file lives.
- **Custom oxlint rules** (`.archgate/lint/oxlint.ts`, registered in `.oxlintrc.json` `jsPlugins`, enabled as `archgate/<rule>`) enforce _static syntactic invariants_ — pattern X in source must/must-not look like Y. AST-based, precise spans, IDE-visible.
- **ADR `.rules.ts`** are for _project-structure/governance checks_ that don't fit a per-file lint model (cross-file sync, docs parity, dependency policy).
- `.archgate/lint/` is the archgate-standard home for ADR-complementing linter rules (see its README); the plugin file is NOT in tsconfig `include` or knip `project`, but oxlint lints it, so it must itself pass all oxlint rules.
- **oxlint jsPlugins have full module resolution and top-level await** — a plugin can `await import("inquirer")` at load and derive its allowlist from the installed dependency's runtime state (e.g. `Object.keys(inquirer.prompt.prompts)`). Prefer this over hardcoded allowlists: the rule then self-updates on dependency bumps and stale call sites fail lint in the bump PR itself. Guard with a loud throw if the upstream API shape changes, so the rule can never silently disable itself.
