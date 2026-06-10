---
id: ARCH-005
title: Testing Standards
domain: architecture
rules: true
files: ["tests/**/*.ts"]
---

## Context

Automated tests prevent regressions and document expected behavior. The CLI needs a testing strategy that is fast, works natively with the Bun runtime, and scales as the command surface and engine grow.

The test suite must balance coverage with maintainability — too few tests miss regressions, too many create a maintenance burden that slows development.

**Alternatives considered:**

- **Jest** — The most popular JavaScript testing framework. However, Jest requires configuration for TypeScript, adds multiple production-weight dependencies (`ts-jest` or `@swc/jest` transforms), and its module mocking system relies on CommonJS conventions that conflict with Bun's native ES module resolution. Running Jest under Bun requires compatibility workarounds that defeat the purpose of using Bun.
- **Vitest** — A modern, Vite-powered test runner with native TypeScript and ESM support. Vitest is well-designed but adds a significant dependency tree (Vite, its plugin system, and associated tooling). For a CLI that already runs on Bun, adding Vite's build pipeline is unnecessary overhead. Vitest's main advantages (watch mode, HMR-powered re-runs) are replicated by `bun test --watch`.
- **No test framework (custom assertions)** — Writing tests with plain `assert` and a custom runner. This minimizes dependencies but sacrifices developer experience: no structured test output, no watch mode, no built-in mocking, and no standard `describe`/`it` API that contributors already know.

Bun's built-in test runner (`bun test`) provides a Jest-compatible API (`describe`, `it`, `expect`), native TypeScript execution (no transform step), fast startup, and built-in watch mode. It requires zero additional dependencies and runs tests in the same runtime as production code, eliminating runtime behavior discrepancies.

## Decision

Use Bun's built-in test runner (`bun test`) for all tests. Test files go in `tests/` mirroring the `src/` directory structure. Fixtures go in `tests/fixtures/`. Target 90% code coverage, enforced in CI.

**Key conventions:**

1. **Directory structure mirrors `src/`** — A source file at `src/engine/runner.ts` has its test at `tests/engine/runner.test.ts`. This makes tests discoverable by convention.
2. **Fixtures in `tests/fixtures/`** — Sample ADR files and mock codebases live in a shared fixtures directory. Fixtures are reusable across test suites.
3. **Temp directories for filesystem tests** — Tests that write files use `mkdtemp` for isolation. Temp directories are cleaned up in `afterEach` or `afterAll`.
4. **Test file naming** — Test files use the `.test.ts` suffix: `<module-name>.test.ts`.
5. **Coverage target: 90%** — Enforced in CI. PRs that drop total line coverage below 90% are blocked by the `Validate Code` gate check.

## Do's and Don'ts

### Do

- Place test files in `tests/` matching `src/` structure
- Use `tests/fixtures/` for sample data files
- Use temp directories (`mkdtemp`) for tests that write to the filesystem
- Clean up temp directories in `afterEach` or `afterAll`
- **Close external SDK instances** (servers, clients, transports) in `afterEach` or `afterAll` by calling their cleanup method (e.g., `await server.close()`). Manage their lifecycle in `beforeEach`/`afterEach` rather than inside individual test bodies so cleanup is guaranteed.
- **When a test creates a temp git repo and needs to call `git commit`, configure local user identity first** — CI runners have no global git config, so commits fail without explicit local identity. Set it with `await Bun.$\`git config user.email "test@test.com"\`.cwd(tempDir).quiet()`and`await Bun.$\`git config user.name "Test"\`.cwd(tempDir).quiet()`immediately after`git init`.
- Test public module interfaces, not private implementation details
- Use descriptive test names that explain the expected behavior
- **Every test MUST contain at least one `expect()` assertion** — enforced by the custom `bun-test/expect-expect` oxlint plugin at `lint/expect-expect.ts` (registered via `jsPlugins` in `.oxlintrc.json`, enabled for `tests/**/*.test.ts`). `bun run lint` fails on any runnable `test()`/`it()` whose body contains no `expect()`. oxlint's built-in `jest/expect-expect` does not cover `bun:test`, which is why this plugin exists.
- **Make implicit "does not throw" contracts explicit** — for a smoke test that merely invokes a function, assert the contract: `expect(() => fn()).not.toThrow()` for synchronous calls, or `await expect(promise).resolves.toBeUndefined()` for async calls. Calling a function with no assertion provides false confidence and is blocked by the assertion rule.
- **Use `test.skip` or `test.todo` for intentionally empty or disabled tests** — the `bun-test/expect-expect` rule deliberately ignores `.skip` and `.todo` so placeholders remain explicit and self-documenting.
- **When adding the first `expect()` to a previously assertion-less test file, add `expect` to the `bun:test` import** — older smoke-test files (e.g., `sentry.test.ts`) historically omitted it because their bodies never asserted.
- **When mocking `fetch` in tests, assign directly to `globalThis.fetch`** — use `globalThis.fetch = mockFn as unknown as typeof fetch`. Restore in `afterEach` via `mock.restore()` (from `bun:test`) or by reassigning the original reference before the test.
- **Wrap `spyOn` / `mockImplementation` calls in `try/finally` to guarantee `mockRestore()` runs** — when `expect()` assertions fail, they throw immediately, skipping any `mockRestore()` that follows. The un-restored spy leaks into subsequent tests, causing false positives or false negatives. Pattern: `const spy = spyOn(...).mockImplementation(() => {}); try { /* assertions */ } finally { spy.mockRestore(); }`. Alternatively, create and restore spies in `beforeEach`/`afterEach` hooks instead of inline.
- **Make large production thresholds injectable so tests can use a small value** — When production code only acts past a large numeric threshold (e.g., `SCOPE_FILE_WARN_THRESHOLD = 1000` in `src/engine/git-files.ts`), add an optional parameter that defaults to the module constant (e.g., `resolveScopedFiles(root, globs, { fileWarnThreshold })`). Tests inject a tiny value such as `5` and create only a handful of files to exercise the same code path. This keeps the test fast and deterministic on every platform instead of materializing thousands of fixture files.
- **Only ever raise a per-test timeout override above the global, never below it** — the project global is `bun test --timeout 60000` (60s). A per-test `}, 30_000` override makes that test _more_ likely to time out than the default. Use a per-test override solely to grant a genuinely slow test more time than 60s; never set one shorter than the global.
- **Mock first-party modules with `import * as mod` + `spyOn(mod, "fn")`, not `mock.module()`** — declare `import * as authMod from "../../src/helpers/auth"`, then in `beforeEach` install `spyOn(authMod, "requestDeviceCode").mockResolvedValue(...)` and restore with `mock.restore()` in `afterEach`. `spyOn` is scoped per-test and auto-restored, and it correctly reaches BOTH static named-import consumers (Bun backs named imports with live bindings) AND dynamic `await import()` consumers, because it mutates the single shared module instance. This is the same pattern used for `spyOn(pathsMod, "findProjectRoot")`.
- **When a test must redirect user-scope paths (home directory), mock `os.homedir()` — a runtime `HOME` env override does NOT work** — Bun caches `os.homedir()` on Linux, so setting `process.env.HOME`/`Bun.env.HOME` inside a test is silently ignored and the code under test resolves the REAL home directory. Declare `import * as os from "node:os"`, install `spyOn(os, "homedir").mockReturnValue(tempDir)` in `beforeEach`, and restore with `mockRestore()` in `afterEach` — the spy reaches named `import { homedir }` consumers in other modules via the same live-binding mechanism as first-party `spyOn`. Env-var overrides remain valid ONLY for code that reads `Bun.env.*` directly at call time (e.g., the `APPDATA` branch in `vscode-settings.ts`, or `paths.ts` helpers documented as "resolved at call time"). Production code MUST NOT be rewritten to read `Bun.env.HOME` just to make env overrides work — mock the implementation in the test instead.

### Don't

- Don't test private implementation details — test the public API of each module
- Don't depend on network access in unit tests
- Don't leave temp files after test runs
- **Don't leave external SDK instances open after tests** — instances from external libraries may hold internal references that keep Bun's event loop alive on Linux, causing `bun test` to hang indefinitely after all tests complete even though every test passes. Always call the cleanup method in `afterEach`.
- **Don't rely on globally-configured git identity in temp git repos** — always set `user.email` and `user.name` locally in any repo that makes commits. Omitting this works locally (where developers have global git config) but fails silently in CI, producing a cryptic `ShellPromise` error with no indication that git identity is the cause.
- **Don't let tests send real events to Sentry** — set `Bun.env.NODE_ENV = "test"` in `beforeEach` (and restore in `afterEach`) for any test that initializes Sentry. The Sentry SDK is configured with `enabled: Bun.env.NODE_ENV !== "test"` to prevent test noise from polluting production error tracking.
- Don't skip tests without a tracking issue
- **Don't write assertion-less tests** — a `test()`/`it()` body with no `expect()` call silently passes and gives false confidence. The `bun-test/expect-expect` oxlint plugin blocks these at lint time.
- **Don't use a bare early `return` or an empty callback body to conditionally skip a test** — use `test.skipIf(condition)`, `test.skip`, or `test.todo` so the skip is explicit and the assertion rule can recognize it. Bare returns and empty bodies are exactly how assertion-less tests accumulated silently before the rule existed.
- Don't import test utilities from `node:test` — use Bun's built-in `bun:test` module
- **Don't use `mock.module("node:fetch", ...)` to intercept HTTP fetch calls** — in Bun, the runtime fetch is `globalThis.fetch` and `mock.module` targeting `node:fetch` does not intercept it. The mock silently has no effect: the real network is hit, making tests non-deterministic and dependent on external services. Assign `globalThis.fetch` directly instead (see Do's above).
- **Don't use `mock.module()` on a first-party module that any other test file imports** — Bun's `mock.module()` is process-global and retroactive: it replaces the module for ALL test files in the same Bun process and is NOT undone by `mock.restore()`. Symptom: a test that imports the real implementation intermittently receives a mocked one depending on file execution order — a flaky failure that passes in isolation. Do NOT work around this by splitting production code into a separate `-impl` file (or thin delegating wrapper) just so the "real" tests can import an un-mocked path — that contorts the production module layout to serve a test-tool quirk. Fix the test by switching to `spyOn` (see Do's above). `mock.module()` remains acceptable for third-party modules (e.g. `inquirer`, `node:readline`) that no first-party test needs the real implementation of.
- **Don't place `mockRestore()` after assertions without `try/finally` protection** — if the assertion throws, the spy is never restored and contaminates subsequent tests. This is especially dangerous when spying on globals like `console.warn` or `globalThis.fetch`, where a leaked spy silently suppresses or redirects output for every test that follows.
- **Don't materialize large filesystem fixtures (1000+ files, plus `git add .`) just to cross a production threshold** — on Windows CI runners that filesystem work is slow enough to exceed the per-test timeout, killing the staging subprocess mid-run (`git add . failed (exit 143)`, where 143 = 128 + SIGTERM) and producing a flaky failure that does not reproduce locally. Inject a small threshold instead (see Do's above). This was the root cause of a recurring Windows smoke-test flake on the `resolveScopedFiles` warning test.
- **Don't let tests write real user-scope state** (`~/.config/Code/User/settings.json`, `%APPDATA%`, `~/.cursor/`, `~/.config/opencode/`, etc.) — cross-file pollution combined with Bun's non-deterministic test-file execution order produces order-dependent flakes that pass on a PR run and fail after merge with identical code. This was the root cause of the v0.44.0 release failure: `init-project.test.ts` exercised the real `configureVscodeSettings` with mocked credentials and wrote the runner's real `~/.config/Code/User/settings.json`; `vscode-settings.test.ts` then read the polluted file whenever the file execution order flipped (its `HOME` env override was defeated by Bun's `homedir()` caching). The same writes also silently polluted developers' real VS Code settings on local runs. Either spy out the writer at the unit boundary (e.g., `spyOn(vscodeSettings, "configureVscodeSettings")`) or mock `os.homedir()` (see Do's above) so every write lands in a `mkdtemp` directory.

## Implementation Pattern

### Good Example

```typescript
// tests/engine/runner.test.ts
import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("runChecks", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("returns zero violations for a compliant codebase", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "archgate-test-"));
    // Set up fixture files in tempDir...
    const results = await runChecks(adrs, { projectRoot: tempDir });
    expect(results.violations).toHaveLength(0);
  });

  it("exits with code 1 when violations are found", async () => {
    // ...
    expect(getExitCode(results)).toBe(1);
  });
});
```

### Good Example — Temp Git Repo with Commits

```typescript
// tests/engine/git-files.test.ts
it("returns both staged and unstaged changes", async () => {
  await Bun.$`git init`.cwd(tempDir).quiet();
  // GOOD: set local identity before any commit — CI has no global git config
  await Bun.$`git config user.email "test@test.com"`.cwd(tempDir).quiet();
  await Bun.$`git config user.name "Test"`.cwd(tempDir).quiet();
  writeFileSync(join(tempDir, "a.ts"), "export const a = 1;");
  await Bun.$`git add a.ts`.cwd(tempDir).quiet();
  await Bun.$`git commit -m "init"`.cwd(tempDir).quiet();
  // ... rest of test
});
```

### Good Example — Temp Directory Cleanup

```typescript
// tests/helpers/session-context.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encodeProjectPath } from "../../src/helpers/session-context";

describe("encodeProjectPath", () => {
  test("replaces forward slashes with dashes", () => {
    expect(encodeProjectPath("/home/user/project")).toBe("-home-user-project");
  });
});
```

### Bad Example

```typescript
// BAD: test in wrong location (not mirroring src/)
// File: tests/all-tests.test.ts — single monolithic test file

// BAD: testing private internals
import { _internalParser } from "../../src/engine/runner";

// BAD: network dependency in unit test
it("fetches pack from registry", async () => {
  const result = await fetch("https://registry.npmjs.org/...");
});

// BAD: temp files not cleaned up
it("writes output", async () => {
  await Bun.write("/tmp/test-output.json", data);
  // No cleanup — file persists after test
});

// BAD: external resource created inside test body — no guaranteed cleanup path
it("processes data", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "test-"));
  // tempDir never cleaned up — leaks files after test run
  expect(processData(tempDir)).toBeTruthy();
});

// BAD: git commit without local identity — works locally, fails in CI
it("reads changes", async () => {
  await Bun.$`git init`.cwd(tempDir).quiet();
  writeFileSync(join(tempDir, "a.ts"), "x");
  await Bun.$`git add a.ts`.cwd(tempDir).quiet();
  await Bun.$`git commit -m "init"`.cwd(tempDir).quiet();
  // Fails in CI: "*** Please tell me who you are."
});

// BAD: mock.module("node:fetch", ...) does NOT intercept globalThis.fetch in Bun.
// The mock has no effect — the real network is hit and the test becomes non-deterministic.
mock.module("node:fetch", () => ({
  default: () => Promise.reject(new Error("network error")),
}));
// GOOD: assign globalThis.fetch directly
globalThis.fetch = (() =>
  Promise.reject(new Error("network error"))) as unknown as typeof fetch;

// BAD: mock.module on a first-party module is process-global and leaks into
// EVERY other test file in the process — auth.test.ts then receives this mock
// instead of the real implementation (flaky, order-dependent).
mock.module("../../src/helpers/auth", () => ({
  requestDeviceCode: mock(() => Promise.resolve({ device_code: "x" })),
}));

// GOOD: spyOn the imported module namespace — per-test and auto-restored.
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

- **Fast test execution** — Bun's native test runner starts in milliseconds and executes TypeScript directly without a transform step
- **No additional test framework dependency** — Bun test is built-in, eliminating Jest/Vitest from `devDependencies` and their transitive dependency trees
- **Fixtures are reusable** — A shared `tests/fixtures/` directory provides consistent sample data across test suites, reducing duplication
- **Same runtime for tests and production** — Tests run in Bun, the same runtime as the CLI itself. No behavior discrepancies from running tests in Node.js but production in Bun.

### Negative

- **Bun test runner has fewer features than Jest/Vitest** — No built-in code coverage reporting (requires `--coverage` flag, which has limitations), no snapshot testing, and limited mock utilities compared to Jest's comprehensive mocking system.
- **Limited community resources** — Fewer Stack Overflow answers, blog posts, and tutorials compared to Jest. Contributors may need to consult Bun documentation directly.

### Risks

- **Bun test runner API changes** — Although Bun is past 1.0, some newer APIs may still evolve between minor versions. Test runner behavior or API may change.
  - **Mitigation:** The project pins a specific Bun version via `.prototools`. Test runner API changes are caught during controlled Bun upgrades with full test suite validation.
- **Coverage reporting gaps** — `bun test --coverage` may not report accurate coverage for all code paths, especially for dynamically imported modules.
  - **Mitigation:** The 90% threshold is enforced on total line coverage, not per-file. Individual modules with dynamically-loaded code paths may have lower per-file coverage as long as the aggregate stays above 90%. Critical modules (engine, formats) are tested thoroughly regardless of aggregate numbers.
- **Third-party SDK event loop retention** — External SDK instances that hold internal resource references may keep Bun's event loop alive on Linux after all tests complete, causing `bun test` to hang indefinitely. This does not surface on macOS (event loop drains normally there), making it a Linux-CI-only failure that is hard to reproduce locally.
  - **Mitigation:** Always manage external resource lifecycle in `beforeEach`/`afterEach` and call the cleanup method (`close()`, `destroy()`, `disconnect()`) in `afterEach`. Add `timeout-minutes` to CI jobs as a safety net — the `code-pull-request.yml` job is set to 10 minutes to cap any future regressions.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-005/test-mirrors-src`: Scans all source files in `src/` and verifies a corresponding `.test.ts` file exists in `tests/`. Severity: `error`.
- **oxlint plugin** `bun-test/expect-expect` (`lint/expect-expect.ts`): A custom oxlint JS plugin enabled for `tests/**/*.test.ts` that fails the build for any runnable `test()`/`it()` (including `test.skipIf(...)()`, `test.each(...)()`) whose body contains no `expect()` call. It ignores `test.skip` and `test.todo`. Runs as part of `bun run lint` (and therefore `bun run validate` and CI). oxlint's built-in `jest/expect-expect` only recognizes `jest`/`vitest` imports, so it does not cover `bun:test` — this plugin fills that gap.
- **CI pipeline**: `bun test --timeout 60000` runs on every pull request. Test failures and per-test timeouts block merge. All workflow jobs have `timeout-minutes` set to prevent indefinite hangs.
- **Coverage threshold**: The `Coverage Report` job enforces a 90% minimum line coverage. If total coverage drops below 90%, the job fails and the `Validate Code` gate blocks the PR.

### Manual Enforcement

Code reviewers MUST verify:

1. New source files have corresponding test files
2. Tests use temp directories for filesystem operations (no hardcoded paths)
3. Tests clean up after themselves (`afterEach`/`afterAll` cleanup) — including both temp directories and external SDK instances
4. Tests that instantiate SDK objects (servers, clients, connections) manage their lifecycle in `beforeEach`/`afterEach`, not inside individual test bodies
5. Tests that call `git commit` on a temp repo configure `user.email` and `user.name` locally before committing
6. Tests that mock HTTP fetch assign `globalThis.fetch` directly — no `mock.module("node:fetch", ...)` usage
7. Tests that use `spyOn` or `mockImplementation` inline (not in `beforeEach`/`afterEach`) wrap the spy lifecycle in `try/finally` to guarantee `mockRestore()` runs even when assertions fail
8. Every test asserts something with `expect()` — no smoke tests that merely call a function; "does not throw" contracts are made explicit via `expect(() => fn()).not.toThrow()` or `await expect(promise).resolves.toBeUndefined()`
9. Tests that exercise a numeric production threshold inject a small threshold value rather than generating fixtures large enough to trip the production default, and no per-test timeout override is shorter than the global `--timeout 60000`
10. Tests mock first-party modules via `import * as mod` + `spyOn`, not `mock.module()` — and no production module has been split into a separate `-impl` file solely to dodge `mock.module` leakage

## References

- [Bun test runner documentation](https://bun.sh/docs/cli/test)
- [ARCH-001 — Command Structure](./ARCH-001-command-structure.md) — In-process execution enables testing commands directly without process spawning
- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — Third-party dependencies introduce runtime behaviors (like event loop retention) that must be accounted for in test teardown
