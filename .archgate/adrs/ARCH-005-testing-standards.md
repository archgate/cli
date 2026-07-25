---
id: ARCH-005
title: Testing Standards
domain: architecture
rules: true
files: ["tests/**/*.ts"]
---

## Context

Automated tests prevent regressions and document expected behavior. The CLI needs a testing strategy that is fast, works natively with the Bun runtime, and scales as the command surface and engine grow — balancing coverage against the maintenance burden a large suite creates.

**Alternatives considered:**

- **Jest** — Rejected: needs TypeScript transform configuration (`ts-jest` / `@swc/jest`), and its CommonJS-oriented module mocking conflicts with Bun's native ESM resolution, so running it under Bun requires workarounds that defeat the point of using Bun.
- **Vitest** — Rejected: native TypeScript and ESM support, but it pulls Vite's build pipeline into a CLI that already runs on Bun, and its watch/HMR advantage is covered by `bun test --watch`.
- **No test framework (custom assertions)** — Rejected: minimal dependencies, but no structured output, no watch mode, no built-in mocking, and none of the standard `describe`/`it` API contributors already know.

Bun's built-in test runner (`bun test`) provides a Jest-compatible API, native TypeScript execution with no transform step, fast startup, and watch mode — with zero additional dependencies, running tests in the same runtime as production code.

## Decision

Use Bun's built-in test runner (`bun test`) for all tests. Test files live in `tests/`, mirroring `src/`; fixtures live in `tests/fixtures/`. Target 90% code coverage, enforced in CI.

**Key conventions:**

1. **Directory structure mirrors `src/`** — `src/engine/runner.ts` is tested by `tests/engine/runner.test.ts`, so tests are discoverable by convention.
2. **Fixtures in `tests/fixtures/`** — sample ADR files and mock codebases are shared across suites.
3. **Temp directories for filesystem tests** — tests that write files use `mkdtemp` for isolation and clean up in `afterEach` or `afterAll`.
4. **Test file naming** — `<module-name>.test.ts`.
5. **Coverage target: 90%** — enforced in CI. PRs that drop total line coverage below 90% are blocked by the `Validate Code` gate check.
6. **Isolation is the test author's job** — Bun runs every test file in one process, so environment writes, `mock.module()` calls, and un-restored spies escape into later files and produce order-dependent flakes. Restore env vars with `restoreEnv()`, mock first-party modules with `spyOn` over an `import * as mod` namespace, and keep every write inside a `mkdtemp` directory.
7. **Mock `os.homedir()`, never `HOME`** — Bun caches `os.homedir()` on Linux, so a runtime `HOME` override is silently ignored and the code under test resolves the REAL home directory. Env-var overrides remain valid ONLY for code that reads `Bun.env.*` at call time (`vscode-settings.ts`'s `APPDATA` branch, the `paths.ts` helpers documented as "resolved at call time"). Production code MUST NOT be rewritten to read `Bun.env.HOME` just to make an env override work.
8. **Per-test timeouts only ever raise the global** — the suite runs `bun test --timeout 60000`, so a shorter override such as `}, 30_000` makes that test _more_ likely to time out, not less.

## Do's and Don'ts

### Do

- **DO** mirror `src/` in `tests/` (`src/engine/runner.ts` → `tests/engine/runner.test.ts`), keep sample data in `tests/fixtures/`, and confine filesystem writes to `mkdtemp` dirs removed in `afterEach`/`afterAll`.
- **DO** test each module's public interface with descriptive behavior-stating names, never private internals.
- **DO** restore environment variables with `restoreEnv(key, original)` from `tests/test-utils.ts` — required for every `Bun.env.X`/`process.env.X` capture, including `NODE_ENV`, `GIT_CONFIG_GLOBAL`, and `HOME`.
- **DO** close external SDK instances (servers, clients, transports) with `await server.close()` in `afterEach`/`afterAll`, managing their lifecycle in hooks rather than test bodies.
- **DO** set `git config user.email` and `user.name` locally right after `git init` and before any `git commit` — CI runners have no global git config.
- **DO** assert with `expect()` in every test — every test MUST contain at least one assertion, and `bun-test/expect-expect` fails `bun run lint` otherwise. Spell out "does not throw" as `expect(() => fn()).not.toThrow()` or `await expect(promise).resolves.toBeUndefined()`; use `test.skip`/`test.todo` for placeholders.
- **DO** mock fetch by assigning `globalThis.fetch = mockFn as unknown as typeof fetch`, restored in `afterEach` via `mock.restore()`.
- **DO** wrap inline `spyOn`/`mockImplementation` in `try/finally` so `mockRestore()` runs even when an assertion throws, or manage spies in hooks instead.
- **DO** make large production thresholds injectable — `resolveScopedFiles(root, globs, { fileWarnThreshold })` overrides `SCOPE_FILE_WARN_THRESHOLD` in `src/engine/git-files.ts`, so a test injects `5` instead of creating 1000 files.
- **DO** mock first-party modules and `os.homedir()` with `import * as mod` + `spyOn(mod, "fn")` in `beforeEach`, restored by `mock.restore()` in `afterEach`.

### Don't

- **DON'T** hit the network in unit tests, import from `node:test` (use `bun:test`), or try `mock.module("node:fetch", ...)` — Bun's runtime fetch is `globalThis.fetch`, so that mock silently does nothing.
- **DON'T** call `mock.module()` on a first-party module — it is process-global, retroactive, and NOT undone by `mock.restore()`, so other test files intermittently receive the mock. Never split production code into an `-impl` file to dodge it; `mock.module()` stays acceptable for third-party modules (`inquirer`, `node:readline`).
- **DON'T** restore an environment variable with a bare `Bun.env.X = original` / `process.env.X = original` assignment — `undefined` assigns the literal string `"undefined"` and leaves the key set.
- **DON'T** leave temp files behind or external SDK instances open after a test.
- **DON'T** rely on globally-configured git identity in a temp git repo — it works locally and fails only in CI, with a cryptic `ShellPromise` error.
- **DON'T** let tests touch real state: set `Bun.env.NODE_ENV = "test"` before initializing Sentry (the SDK sets `enabled: Bun.env.NODE_ENV !== "test"`), and never write real user-scope paths (`~/.config/Code/User/settings.json`, `%APPDATA%`, `~/.cursor/`, `~/.config/opencode/`) — spy out the writer or mock `os.homedir()`.
- **DON'T** write assertion-less tests, skip one with a bare early `return` or empty callback body (use `test.skipIf(condition)`, `test.skip`, or `test.todo`), or skip without a tracking issue.
- **DON'T** materialize large filesystem fixtures (1000+ files, plus `git add .`) just to cross a production threshold — inject a small threshold instead.

## Implementation Pattern

### Good Example

```typescript
// tests/engine/runner.test.ts
import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { git } from "../test-utils";

describe("runChecks", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("returns zero violations for a compliant codebase", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "archgate-test-"));
    // GOOD: the shared `git` helper wraps Bun.spawn with array args (ARCH-007)
    await git(["init"], tempDir);
    // GOOD: local identity before any commit — CI has no global git config
    await git(["config", "user.email", "test@test.com"], tempDir);
    await git(["config", "user.name", "Test"], tempDir);
    await git(["commit", "--allow-empty", "-m", "init"], tempDir);
    const results = await runChecks(adrs, { projectRoot: tempDir });
    expect(results.violations).toHaveLength(0);
  });
});
```

### Bad Example

```typescript
// BAD: one monolithic tests/all-tests.test.ts instead of mirroring src/
// BAD: reaching into private internals
import { _internalParser } from "../../src/engine/runner";

// BAD: network dependency in a unit test
it("fetches pack from registry", async () => {
  const result = await fetch("https://registry.npmjs.org/...");
});

// BAD: temp resource created in the test body — no guaranteed cleanup path
it("processes data", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "test-"));
  expect(processData(tempDir)).toBeTruthy();
});

// BAD: mock.module("node:fetch") does not intercept globalThis.fetch in Bun,
// so the real network is hit and the test is non-deterministic.
mock.module("node:fetch", () => ({
  default: () => Promise.reject(new Error("network error")),
}));
// GOOD: assign globalThis.fetch directly
globalThis.fetch = (() =>
  Promise.reject(new Error("network error"))) as unknown as typeof fetch;

// BAD: mock.module on a first-party module is process-global and leaks into
// every other test file, so auth.test.ts receives this mock instead of the
// real implementation — an order-dependent flake.
mock.module("../../src/helpers/auth", () => ({
  requestDeviceCode: mock(() => Promise.resolve({ device_code: "x" })),
}));

// GOOD: spy the imported module namespace — per-test and auto-restored.
import * as authMod from "../../src/helpers/auth";
beforeEach(() => {
  spyOn(authMod, "requestDeviceCode").mockResolvedValue({ device_code: "x" });
});
afterEach(() => {
  mock.restore();
});
```

## Consequences

### Positive

- **Fast test execution** — Bun's native runner starts in milliseconds and executes TypeScript directly, with no transform step.
- **No additional test framework dependency** — `bun test` is built in, keeping Jest/Vitest and their transitive trees out of `devDependencies`.
- **Familiar API** — the Jest-compatible `describe`/`it`/`expect` surface and `bun test --watch` need no onboarding.
- **Fixtures are reusable** — a shared `tests/fixtures/` directory provides consistent sample data across suites.
- **Same runtime for tests and production** — no behavior discrepancies from testing in Node.js while shipping on Bun.
- **Lint-enforced test hygiene** — custom oxlint plugins catch assertion-less tests and unguarded env restores before CI runs the suite.

### Negative

- **Fewer features than Jest/Vitest** — coverage reporting is limited to the `--coverage` flag and mock utilities are sparse next to Jest's, though snapshot testing (`toMatchSnapshot`, `toMatchInlineSnapshot`) is supported.
- **Limited community resources** — fewer Stack Overflow answers and tutorials; contributors consult Bun documentation directly.
- **One shared process** — `mock.module()` is process-global and not undone by `mock.restore()`, and env writes escape into later test files, so isolation is the test author's responsibility rather than the runner's.

### Risks

- **Bun test runner API changes** — newer APIs may still evolve between minor versions.
  - **Mitigation:** the project pins a Bun version via `.prototools`; API changes surface during controlled upgrades with full suite validation.
- **Coverage reporting gaps** — `bun test --coverage` may misreport code paths, especially dynamically imported modules.
  - **Mitigation:** the 90% threshold is enforced on total line coverage, not per-file, and critical modules (engine, formats) are tested thoroughly regardless of the aggregate.
- **Cross-file pollution from shared process state** — leaked env vars, leaked spies, and writes to real user-scope files produce order-dependent flakes that pass on a PR run and fail after merge with identical code.
  - **Mitigation:** `restoreEnv()` for every env capture, `try/finally` around inline spies, and an `os.homedir()` spy that keeps writes inside a `mkdtemp` directory; `test-isolation/no-bare-env-restore` blocks the env variant at lint time.
- **Platform-specific hangs and timeouts** — an external SDK instance left open keeps Bun's event loop alive on Linux and hangs `bun test` after every test passes, while slow Windows CI filesystems let large fixtures blow the per-test timeout and kill the staging subprocess (`git add . failed (exit 143)`, where 143 = 128 + SIGTERM). Neither reproduces on macOS or locally.
  - **Mitigation:** close SDK instances in `afterEach`, inject small thresholds instead of generating large fixtures, and cap every CI job with `timeout-minutes` (10 minutes for `code-pull-request.yml`).

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-005/test-mirrors-src`: scans `src/` and verifies a corresponding `.test.ts` file exists in `tests/`. Severity: `error`.
- **oxlint plugin** `bun-test/expect-expect` (`lint/expect-expect.ts`): enabled for `tests/**/*.test.ts`, it fails the build for any runnable `test()`/`it()` (including `test.skipIf(...)()` and `test.each(...)()`) whose body contains no `expect()` call, while ignoring `test.skip` and `test.todo`. oxlint's built-in `jest/expect-expect` recognizes only `jest`/`vitest` imports, so it does not cover `bun:test` — this plugin fills that gap.
- **oxlint plugin** `test-isolation/no-bare-env-restore` (`lint/no-bare-env-restore.ts`): enabled for `tests/**/*.test.ts`, it fails the build for any `Bun.env.NAME = <identifier>` or `process.env.NAME = <identifier>` assignment whose identifier was itself captured from an env read earlier in the same file (e.g. `const originalHome = Bun.env.HOME`). Tracking the capture rather than a naming convention such as `original*` is what separates a restore from an override — both are spelled alike, so `Bun.env.HOME = tempDir` is deliberately left alone, as is computed access (`Bun.env[key]`), which is the shape of the `restoreEnv` helper itself.
- Both plugins are registered via `jsPlugins` in `.oxlintrc.json` and run as part of `bun run lint` (and therefore `bun run validate` and CI).
- **CI pipeline**: `bun test --timeout 60000` runs on every pull request. Test failures and per-test timeouts block merge, and all workflow jobs set `timeout-minutes` to prevent indefinite hangs.
- **Coverage threshold**: the `Coverage Report` job enforces a 90% minimum line coverage; below that it fails and the `Validate Code` gate blocks the PR.

### Manual Enforcement

Code reviewers MUST verify:

1. New source files have corresponding test files, and every test asserts with `expect()` — no smoke test that merely calls a function.
2. Filesystem work happens in temp directories (no hardcoded paths), and both temp directories and external SDK instances are cleaned up in `afterEach`/`afterAll`, with SDK lifecycles managed in hooks rather than test bodies.
3. Temp repos that call `git commit` configure `user.email` and `user.name` locally first.
4. HTTP mocking assigns `globalThis.fetch`; first-party mocking uses `import * as mod` + `spyOn`, with no production module split into an `-impl` file to dodge `mock.module` leakage.
5. Inline `spyOn`/`mockImplementation` usage wraps the spy lifecycle in `try/finally` so `mockRestore()` runs even when assertions fail.
6. Threshold tests inject a small value rather than generating fixtures large enough to trip the production default, and no per-test timeout override is shorter than the global `--timeout 60000`.
7. Shared test helpers under `tests/**` that are not `*.test.ts` files (e.g. `tests/integration/cli-harness.ts`, `tests/test-utils.ts`) restore environment variables via `restoreEnv` — `test-isolation/no-bare-env-restore` is scoped to `tests/**/*.test.ts` and does not cover them, yet a leak from a shared helper reaches every test that imports it.

### Exceptions

**Documented briefing-budget overflow** (reported by `archgate check`): the `Do's and Don'ts` section exceeds the `review-context` briefing cap. The section is ordered so the `Decision` and all ten `**DO**` items fit inside the window; the overflow is the `**DON'T**` list, where each item is the terse inverse of a visible Do or of a Decision convention. Shortening it further would drop a distinct anti-pattern, so the overflow stands and consumers MUST open the full ADR for the Don'ts.

## References

- [Bun test runner documentation](https://bun.sh/docs/cli/test)
- [ARCH-001 — Command Structure](./ARCH-001-command-structure.md) — In-process execution enables testing commands directly without process spawning
- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — Third-party dependencies introduce runtime behaviors (like event loop retention) that must be accounted for in test teardown
