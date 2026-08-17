---
name: coverage-measurement
description: How to reproduce CI's merged coverage number locally, and the cache-busting import that makes a tested file read as uncovered
metadata:
  type: project
---

CI enforces a 99.9% floor on merged Linux+Windows coverage. Two things make a local number disagree with it, and both send you chasing work that does not exist.

## Reproducing CI's number

**Bun's `All files` summary line is not CI's number.** CI filters the merged lcov to `src/*` and computes `sum(LH)/sum(LF)`; bun's own table includes `tests/` and averages differently, so the two disagree by several points.

Locally:

```
awk -F: '/^SF:/{p=($2~/^src[\\\/]/)} /^LF:/{if(p)f+=$2} /^LH:/{if(p)h+=$2} END{printf "%.2f\n",h/f*100}' coverage/lcov.info
```

A single-platform local run is a **floor**, not the CI figure — CI unions Linux and Windows and counts a line covered if either platform hit it. The gap is large enough to mislead: `platform.ts` reads as 64 missed on Windows alone, 12 merged.

For the real per-file picture:

```
gh run download <run-id> -R archgate/cli -n coverage-linux -n coverage-windows -D cov
```

`-n` repeats, `-D` does not — a second `-D` silently overrides the first, so both artifacts land under one root as `cov/coverage-linux/lcov.info` and `cov/coverage-windows/lcov.info`. Union the `DA:<line>,<hits>` records across both files, keyed by the path from `src/` onward, counting a line covered when summed hits exceed zero. That reproduces the PR comment's number digit for digit.

Two traps in the tooling itself:

- `bun test --coverage-dir` is silently ignored — `bunfig.toml`'s `[test] coverageDir` wins — so every concurrent run clobbers the same `coverage/lcov.info`. Isolate a run with a private config (`bun --config=<file>`), or read per-file numbers off the text reporter's stdout.
- The text reporter is not equivalent to the lcov: it omits closing-brace lines from its "Uncovered Line #s" column while still counting them against the percentage, so a file can show a blank column at under 100%.

## A cache-busting import hides coverage

`await import(`../mod?t=${Date.now()}`)` makes Bun load a second module instance whose execution is attributed to nothing. The source file then reports its paths uncovered while they are in fact tested, so the reporter understates and the "gap" is an illusion.

Check for this specifier before writing tests for any file that looks mysteriously uncovered. Removing it took `update-check.ts` from 76.47% to 100% with zero new tests.

A static import is safe only when the module holds no mutable module-level state; verify that first (file-backed caches and `Bun.env` reads at call time are fine).

See also [[ci-run-behavior]] — a cancelled Windows job drops `coverage-windows`, so the merge falls back to Linux alone and lands just under the gate.
