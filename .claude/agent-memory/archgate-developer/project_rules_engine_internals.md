---
name: project-rules-engine-internals
description: Open follow-up work and known unfixed bugs in the ADR rules engine that no rule or test tracks
metadata:
  type: project
---

- Rules-file load is still re-parsed per invocation — `runner.ts`'s per-run caches do NOT cover it; deferred, see #345.
- `ARCH-023-engine-file-listing-via-in-memory-git-tracked-matching.rules.ts`'s `scan-confined-to-fallback-modules` check has the same class of bug archgate/cli#513 fixed in ARCH-020's `glob-scan-dot`: it regexes raw source (`/\.scan\(([^)]*)\)/gu`, per its own comment "Same call-site detection as ARCH-020's glob-scan-dot rule") instead of walking `ctx.ast()`, so a comment or string mentioning `.scan(` in a `src/engine/` file outside the allowlist is misreported as a violation. Confirmed live 2026-07-26 by fire-testing a fixture with a `.scan()`-mentioning comment and string literal (no real call) — both false-flagged at their own lines. Not yet fixed; out of #513's scope (that issue named only ARCH-020). If asked to fix rule-authoring text-matching bugs in this repo, check this rule too — the fix is a straight port of ARCH-020's `ctx.findAstNodes`-based approach (see [[feedback_prefer_tests_over_adr_rules]] for the enforcement-layer framing).
