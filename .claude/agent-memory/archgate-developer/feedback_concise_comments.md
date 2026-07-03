---
name: feedback-concise-comments
description: Keep code comments and memory entries concise — do not overgenerate explanatory prose
metadata:
  type: feedback
---

Code comments and memory entries must be concise. Do not write multi-paragraph explanatory comments in source/workflow files, and do not write long-winded memory bullets.

**Why:** User feedback via `/feedback` (2026-07-03): "sonnet is overgenerating comments in code and memories. this is not good. those comments must be concise." Given directly as a correction after a session where I wrote long comment blocks in `.github/workflows/*.yml` and `src/cli.ts` (multi-sentence rationale blocks) and multi-sentence [[MEMORY.md]] bullets with full incident narratives.

**How to apply:**

- Code/workflow comments: one line stating _what_ and, if truly non-obvious, a terse _why_ — not a paragraph with incident timelines, confirmed-via citations, or full backstory. Link to a PR/issue/commit for detail instead of inlining it.
- Memory entries (`MEMORY.md` bullets and topic files): lead with the rule in one line; keep **Why:**/**How to apply:** to single short sentences, not multi-clause narratives with timestamps and evidence trails.
- If tempted to write a long comment or memory entry to "preserve context," prefer a short pointer (file/PR reference) over inlining the full story.
- Applies to all future sessions in this repo — re-check comment/memory length before writing.
