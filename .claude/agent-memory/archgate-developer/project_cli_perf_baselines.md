---
name: project-cli-perf-baselines
description: Measured CLI startup baselines behind the cli-perf.test.ts budgets, and how to profile when one fires
metadata:
  type: project
---

Baselines behind the budgets in `tests/integration/cli-perf.test.ts`, measured 2026-05-09 on Windows: `--help` ~260ms, `--version` ~250ms, `adr list` ~400ms, `check` ~750ms. Budgets sit at roughly 3-4x these numbers so they catch regressions without flaking on slow CI runners.

**Why:** The raw measurements were inlined in the test file and removed by the GEN-004 comment sweep (the budget constants keep their own doc comments; the dated table does not belong in source). They are the only reference point for judging whether a budget failure is a real regression or an environment artifact.

**How to apply:**

- A budget firing at ~1.2x baseline is environmental (cold cache, loaded runner); at 2x+ suspect a real regression.
- Profile with `bun --inspect` or by bisecting module imports — startup cost in this CLI is dominated by module parse, which is why ARCH-018 lazy-loads heavy dependencies and why an eager top-level import in `src/cli.ts` is the usual culprit.
- Re-measure and update this entry when the baseline legitimately moves (new eager dependency, Bun upgrade); dated numbers are only useful if the date is honest.
