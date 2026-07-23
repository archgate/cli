---
name: forward-only-docs
description: Repo docs must be forward-only and version-independent — describe current state, never the past or a pinned release version
metadata:
  type: feedback
---

Documentation text (root markdown, ADRs, READMEs) must describe the **current state only**. Two rules:

1. **Forward-only.** No historical or change framing: no "previously", "used to", "no longer", "deprecated", "renamed from", "rather than the old X", "not a standalone Y", "corrected", "shipped" annotations, or dated correction notes. If a reader wants to know what changed, that's what git history is for.
2. **Version-independent.** Don't hardcode the current release version (`v0.50.0`, `as of v0.30.x`) or drift-prone counts (`31 ADRs`). These go stale every release. Say "the current release", "its own ADRs", or point at the source of truth (`package.json`, `.prototools`, `src/cli.ts`) instead. Stable minimum-requirement versions that rarely change (e.g. min Bun) are a judgment call — prefer a pointer over a hardcoded number.

**Why:** User directive on PR #492 (root-docs refresh). Hardcoded versions and past-tense framing are exactly the text that silently rots between releases; git already records both the history and the version at any commit.

**How to apply:** When writing or refreshing any doc, state what _is_. Before committing doc text, scan for the phrases above and for release-version/count literals, and remove them. This is the same instinct behind [[feedback_concise_comments]] — say the minimum durable thing and let the source be the source of truth.
