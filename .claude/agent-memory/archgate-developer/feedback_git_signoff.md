---
name: Always commit with --signoff
description: Every git commit must include DCO sign-off (--signoff flag) — CI enforces DCO Sign-off Check
type: feedback
---

Always use `--signoff` (or `-s`) on every `git commit` command. The repo has a DCO Sign-off Check in CI that rejects commits without a `Signed-off-by` trailer.

**Why:** PR #258 failed the DCO check because the commit was created without `--signoff`. The user had to ask for a fix.

**How to apply:** Add `--signoff` to every `git commit` invocation — no exceptions, even for trivial changes.
