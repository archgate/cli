---
name: project-adr-corpus-maintenance
description: How to trim or restructure the ADR corpus without losing governance — briefing budget, the adr-author floors, and why fabricating content is the wrong fix
metadata:
  type: project
---

- **The two briefed sections share one budget, so rebalancing beats cutting.** `review-context --verbose` caps `Decision` and `Do's and Don'ts` separately (GEN-005). When one is far over and the other has headroom, moving a normative rule into the under-budget section increases total visible governance. ARCH-005 went from ~17% of its Do's visible to Decision-plus-all-ten-Do's visible this way. This is legitimate; what GEN-005 forbids is shuffling prose between them purely to clear a warning without increasing what a consumer actually sees.
- **When a section cannot fit, order it so the survivors are the important ones.** Truncation always removes the tail, so front-load guardrails, sequences, and MUST clauses; let recoverable material (path lists already present as `files` globs) fall past the cut. ARCH-022 and GEN-004 are both structured this way.
- **The `adr-author` skill states floors (Do's 5–10, Don'ts 5–8, Positive 5–10, Negative 3–5, Risks 2–4) that several long-standing ADRs do not meet.** ARCH-002, ARCH-008, ARCH-012, ARCH-014, ARCH-018, LEGAL-002 and GEN-003 were already under one or more floors. Treat the floors as preserve-don't-shrink, not as quotas to fill: inventing a Negative or a Risk to reach a count authors new policy under cover of a formatting fix. Report the shortfall instead and let the user decide.
- **Only two things in an ADR are machine-load-bearing; everything else is prose.** The Zod schema validates frontmatter (`id`, `title`, `domain`, `rules`, `files`), and `extractAdrSections` matches the literal strings `## Decision` and `## Do's and Don'ts`. Renaming either heading silently empties the briefing rather than failing, so never "improve" those two headings. Numbered clauses are cited by number from code comments and memory (`ARCH-003 §7`, `ARCH-024 cl.7`) — renumbering breaks those references silently too.
- **`docs/` does not mirror ADR content**, so trimming an ADR cannot desync the documentation site. Verified by searching `docs/` for ADR ids and titles; the site documents commands, not decisions.
