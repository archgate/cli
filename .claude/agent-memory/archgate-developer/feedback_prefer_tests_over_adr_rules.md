---
name: pick-the-right-enforcement-layer
description: Pick the enforcement layer by the nature of the invariant — static syntax → custom oxlint rule, behaviour → tests, governance → ADR .rules.ts; never write an ADR rule that only asserts implementation shape
metadata:
  type: feedback
---

Pick the enforcement layer by the nature of the invariant — don't default to ADR rules.

**Why:** After the inquirer v14 `"list"` → `"select"` crash, a draft ADR `.rules.ts` allowlist rule and a bun test scanning source files were both rejected by the user (an untestable-in-CI check isn't a real test; a per-file syntax check isn't an ADR governance check). The draft rule was never assigned an ADR ID — it landed instead as a custom oxlint JS plugin rule (`archgate/valid-inquirer-prompt-type` in `.archgate/lint/oxlint.ts`) — real AST access, runs in the existing `bun run lint` gate.

**Reinforced 2026-07-15 (rule-scanner RCE):** I proposed an ADR + companion rules for the `.rules.ts` sandbox boundary; the user cut the rules — _"your proposal for rules is actually only testing the implementation and not the behaviour"_ — and took the ADR alone (`rules: false`, ARCH-023). The proposed rules ("scanner defines `ALLOWED_MODULES`", "loader scans before `import()`") asserted implementation _shape_, and the second one **would have passed for the entire lifetime of the vulnerability** — the loader did scan, in the right order; the scan simply didn't work. A structural check cannot distinguish a boundary from the appearance of one. Behaviour (`a rule file cannot reach child_process`) is provable only by executing an attack: `tests/engine/rule-scanner-escapes.test.ts`.

**How to apply:**

- **Tests** verify _behavior_ — if the check can't actually execute the code path (e.g. interactive prompts with no TTY in CI), it is not a test, no matter where the file lives.
- **Before proposing a companion `.rules.ts`, ask what it would assert if the implementation were subtly broken.** If the honest answer is "it would still pass," it is testing shape, not behaviour — write a test and ship the ADR as `rules: false`. An ADR with no rules is a legitimate, complete outcome; a tautological rule is worse than none, because a green check reads as evidence.
- **Custom oxlint rules** (`.archgate/lint/oxlint.ts`, registered in `.oxlintrc.json` `jsPlugins`, enabled as `archgate/<rule>`) enforce _static syntactic invariants_ — pattern X in source must/must-not look like Y. AST-based, precise spans, IDE-visible.
- **ADR `.rules.ts`** are for _project-structure/governance checks_ that don't fit a per-file lint model (cross-file sync, docs parity, dependency policy).
- `.archgate/lint/` is the archgate-standard home for ADR-complementing linter rules (see its README); the plugin file is NOT in tsconfig `include` or knip `project`, but oxlint lints it, so it must itself pass all oxlint rules.
- **oxlint jsPlugins have full module resolution and top-level await** — a plugin can `await import("inquirer")` at load and derive its allowlist from the installed dependency's runtime state (e.g. `Object.keys(inquirer.prompt.prompts)`). Prefer this over hardcoded allowlists: the rule then self-updates on dependency bumps and stale call sites fail lint in the bump PR itself. Guard with a loud throw if the upstream API shape changes, so the rule can never silently disable itself.
