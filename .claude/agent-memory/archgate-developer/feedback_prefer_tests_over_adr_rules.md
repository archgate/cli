---
name: pick-the-right-enforcement-layer
description: Choose the enforcement layer by the nature of the invariant — syntax to a lint rule, behaviour to a test, governance to an ADR rule, CLI behaviour to a built-in
metadata:
  type: feedback
---

Pick the enforcement layer by the nature of the invariant — don't default to ADR rules.

- Static syntax → a custom oxlint plugin rule. Executable behaviour → a test. Cross-file governance → an ADR `.rules.ts`. `rules: false` is a legitimate outcome; a tautological rule is worse than none, because a green check reads as evidence.
- Before proposing a companion rule, ask what it would assert if the implementation were subtly broken. If the honest answer is "it would still pass", it is testing shape, not behaviour.
- A rule that must read a CLI constant or duplicate CLI internals is describing product behaviour every archgate user shares — ship it as a built-in diagnostic on `CheckResult`, not an ADR plus rules (63e8b75 -> ff17b9f).
- **A tool's own config file is not a decision that needs a parallel ADR when the config already self-documents and self-enforces.** Wrote ARCH-026 to formalize `.oxlintrc.json`'s type-aware-linting setup (rule selection, exclusions, version pinning) plus a companion rule asserting `options.typeAware === true` — told directly this was useless: "its application is already enforcing itself and represent the enforcement layer." The config's own inline comments already explained every decision at the point it was made; the companion rule could only ever assert "the config still says what the config says," never catch a real regression the config itself wouldn't also just silently reflect. Removed both files. Contrast with ARCH-014/ARCH-019, which stayed: those document conventions applied by hand across many source files the linter doesn't (and structurally can't) fully verify — a genuinely separate artifact from what enforces them, unlike a linter's own config.
