---
name: project-test-isolation-gotchas
description: Bun test isolation pitfalls — mock.module leakage, shared env across test files, platform-specific flakiness
metadata:
  type: project
---

- **`mock.module` state is process-global across test files.** A helper mock registered in one file leaks into other files' imports of the same module. When a command test needs REAL helper behavior while sibling files mock those helpers, spawn the CLI via `tests/integration/cli-harness`'s `runCli` with `HOME`/`USERPROFILE`/`XDG_DATA_HOME` redirected to a temp dir instead. This is why ARCH-005 prefers `spyOn` over `mock.module`. Hit in session-context list/show tests (PR #446).
- **`Bun.env` overrides leak across parallel test files.** Bun test runner shares one process, so tests setting `Bun.env.HOME`/`GIT_CONFIG_NOSYSTEM`/`GIT_CONFIG_GLOBAL` leak into integration tests that spawn CLI subprocesses via `runCli()` (which spreads `process.env`). Fix: explicitly reset git-related env vars in the `runCli` call, e.g. `runCli(args, dir, { GIT_CONFIG_NOSYSTEM: "", GIT_CONFIG_GLOBAL: "" })`.
- **Git credential tests need system-level isolation on Windows.** Overriding `Bun.env.HOME` is not enough — Windows Credential Manager is a system API, not file-based. Set `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL=<empty-file>` or tests on machines with stored credentials will pick up real tokens.
- **GCM prompt suppression needs 5 env vars**, not just `GIT_TERMINAL_PROMPT=0`: also `GCM_INTERACTIVE=never`, `GCM_GUI_PROMPT=false`, `GIT_ASKPASS=""`, `SSH_ASKPASS=""` (see `gitCredentialEnv()` in `src/helpers/credential-store.ts`).
- **`bun:sqlite` file handles persist after `db.close()` on Windows.** `rmSync` on the temp dir in `afterEach` can throw `EBUSY`. Set `PRAGMA journal_mode = DELETE` to avoid WAL/SHM files, and wrap `rmSync` in try/catch.
- **macOS `/var` → `/private/var` symlink breaks temp dir path comparisons.** `mkdtempSync` returns `/var/folders/...` but `process.cwd()` after `chdir()` resolves to `/private/var/...`. Always wrap with `realpathSync`. Invisible on ubuntu-only PR CI — only surfaces in release builds.
- **Don't test that well-known tools exist on PATH** (e.g. `expect(resolveCommand("bun")).toBe("bun")`) — asserts CI environment state, not logic, and fails when tools are installed via shims. Delete such tests; the null-return and `.exe`-fallback tests already cover the real logic.
