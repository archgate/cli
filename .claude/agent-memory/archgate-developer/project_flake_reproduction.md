---
name: flake-reproduction
description: Reproducing an order-dependent test flake — bun's file ordering ignores your argument order, and WSL gives a local Linux run
metadata:
  type: project
---

A test that fails on Linux CI and passes on a re-run is usually order-dependent cross-file pollution, not a race. Two things make it reproducible.

## bun test ignores the order you list files in

Files are run in directory-traversal order, so a two-file "A then B" reproduction proves nothing until you confirm which actually ran first — read the per-file header lines in the output. Files directly in a directory precede its subdirectories, and the within-directory order is the filesystem's, which on Linux ext4 is not alphabetical.

That asymmetry is the whole reason this class of bug surfaces intermittently on Linux and never on Windows, where NTFS order is stable.

**How to apply:** read the observed order off the output before treating a reproduction as valid. A filename cannot be relied on to place a probe, since sorted order is NTFS behaviour rather than something bun guarantees — expect to try a few positions and confirm each one. A pair that passes is not evidence the pollution is absent.

## WSL runs the suite on Linux without CI

WSL Ubuntu reaches the repo at `/mnt/e/...` and has bun at `~/.proto/bin/bun`. Reach for it before pushing a speculative fix for a Linux-only failure.

Several tests fail there for `/mnt`-specific reasons unrelated to any change (Cursor transcript directories, git repo context, credential-store), so record that baseline failure set first and compare sets rather than counts.

See also [[ci-run-behavior]] for recovering the failure text a re-run erases.
