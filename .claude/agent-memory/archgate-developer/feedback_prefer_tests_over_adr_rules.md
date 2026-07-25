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
