---
name: no-concurrent-load-probes
description: Never run a CLI-spawning probe or a second bun test alongside a full-suite run; the extra load fails unrelated integration tests and fakes a flake
metadata:
  type: feedback
---

Run a full `bun run test` on its own. Never spawn CLI processes, a timing probe, or a second test run while one is in progress.

**Why:** `bun run test` already runs 16 files in parallel on this machine. Extra concurrent load pushed two unrelated integration tests (`check --base`, `review-context`) past 5s and into assertion failures that looked like a new isolation bug; the same suite passed three times in a row once the probe was stopped.

**How to apply:** When confirming a flake fix, run the suite serially several times and read each result before starting anything else. Measure CLI latency (for `tests/integration/cli-perf.test.ts` budgets) either on an idle machine or by adding a temporary log to the perf test itself — a separate probe run concurrently measures the probe's own load. Idle baselines on this machine: `--help`/`--version` ~190ms, `adr list` ~300ms, `check` ~750ms; under the parallel suite a single `check` sample reaches ~2.5s and `--version` can spike to 3s.
