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

Use Bun's built-in test runner (`bun test`) for all tests. Test files live in `tests/`, mirroring `src/`; fixtures live in `tests/fixtures/`. Target 99.5% code coverage, enforced in CI.

**Key conventions:**

1. **Directory structure mirrors `src/`** — `src/engine/runner.ts` is tested by `tests/engine/runner.test.ts`, so tests are discoverable by convention.
2. **Fixtures in `tests/fixtures/`** — sample ADR files and mock codebases are shared across suites.
3. **Temp directories for filesystem tests** — tests that write files use `mkdtemp` for isolation and clean up in `afterEach` or `afterAll`.
4. **Test file naming** — `<module-name>.test.ts`.
5. **Coverage target: 99.5%** — enforced in CI. PRs that drop total line coverage below 99.5% are blocked by the `Validate Code` gate check. A residue is unreachable: Bun emits never-incrementing lcov records for some structural tokens (`} catch {`; on Linux also blank lines, comments, braces).
6. **Isolation is the test author's job** — Bun runs every test file in one process, so environment writes, `mock.module()` calls, and un-restored spies escape into later files and produce order-dependent flakes. Restore env vars with `restoreEnv()`, mock first-party modules with `spyOn` over an `import * as mod` namespace, and keep every write inside a `mkdtemp` directory.
7. **Mock `os.homedir()`, never `HOME`** — Bun caches `os.homedir()` on Linux, so a runtime `HOME` override is silently ignored and the code under test resolves the REAL home directory. Env-var overrides remain valid ONLY for code that reads `Bun.env.*` at call time (`vscode-settings.ts`'s `APPDATA` branch, the `paths.ts` helpers documented as "resolved at call time"). Production code MUST NOT be rewritten to read `Bun.env.HOME` just to make an env override work.
8. **Per-test timeouts only ever raise the global** — `bun run test` applies `--timeout 60000`, so a shorter override such as `}, 30_000` makes that test _more_ likely to time out, not less.

## Do's and Don'ts

### Do

- **DO** mirror `src/` in `tests/`, fixtures in `tests/fixtures/`, writes in `mkdtemp` cleaned up in hooks.
- **DO** test each module's public interface with descriptive names, never private internals.
- **DO** restore env vars with `restoreEnv(key, original)` (`tests/test-utils.ts`) for every capture.
- **DO** close external SDK instances with `await server.close()` in hooks, not test bodies.
- **DO** set `git config user.email`/`user.name` locally after `git init`, before any commit.
- **DO** assert with `expect()` — `bun-test/expect-expect` fails lint otherwise; use `test.skip`/`test.todo` for placeholders.
- **DO** save `globalThis.fetch` before assigning a mock, restore it in `afterEach` — `mock.restore()` doesn't undo a direct assignment.
- **DO** wrap inline `spyOn`/`mockImplementation` in `try/finally` so `mockRestore()` runs on failure, or manage spies in hooks.
- **DO** make thresholds injectable, e.g. `resolveScopedFiles(root, globs, { fileWarnThreshold })` — inject `5`, never materialize 1000+ files (Consequences).
- **DO** mock first-party modules and `os.homedir()` via `import * as mod` + `spyOn(mod, "fn")`, restored by `mock.restore()`.

### Don't

- **DON'T** hit the network, import `node:test` (use `bun:test`), or `mock.module("node:fetch")` — it silently no-ops.
- **DON'T** `mock.module()` a first-party module (OK for `inquirer`, `node:readline`) — never dodge via an `-impl` file split.
- **DON'T** restore an env var with bare `Bun.env.X = original` — `undefined` becomes the string `"undefined"`, not a clear.
- **DON'T** leave temp files or SDK instances open post-test.
- **DON'T** rely on global git identity in a temp repo — passes locally, fails only in CI (`ShellPromise` error).
- **DON'T** touch real state — no real user-scope paths, no unset `NODE_ENV` before Sentry init; spy or mock `os.homedir()`.
- **DON'T** write assertion-less tests or skip silently (bare `return`, empty callback) — use `test.skipIf`/`skip`/`todo` with an issue.

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
// GOOD: assign globalThis.fetch directly, saved beforehand and restored in
// afterEach — mock.restore() does not undo a direct assignment.
let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.reject(new Error("network error"))) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

### Simulating the platform instead of adding a seam

`process.platform` and `process.execPath` are writable, configurable data
properties in Bun. Overriding them covers platform-gated branches without
adding a testability seam to production code.

This is the only approach that moves the coverage aggregate: CI merges Linux
and Windows runs only, so a `test.skipIf(platform !== "darwin")` test
contributes to neither and covers nothing. Parametrize over the matrix
(ARCH-025) so every case runs on every runner.

```typescript
// tests/helpers/vscode-settings.test.ts
import { describe, it, expect, afterEach } from "bun:test";

import { _resetAllCaches } from "../../src/helpers/platform";
import { getVscodeUserSettingsPath } from "../../src/helpers/vscode-settings";

const original = Object.getOwnPropertyDescriptor(process, "platform");

afterEach(() => {
  // GOOD: restore the captured descriptor — an override left in place leaks
  // into every later file, since Bun runs the whole suite in one process.
  if (original) Object.defineProperty(process, "platform", original);
  _resetAllCaches();
});

describe.each([
  ["win32", "AppData"],
  ["darwin", "Library"],
  ["linux", ".config"],
])("on %s", (platform, expected) => {
  it("resolves the user settings path", async () => {
    Object.defineProperty(process, "platform", {
      ...original,
      value: platform,
    });
    // Clear whatever the module cached from the previous value.
    _resetAllCaches();
    expect(await getVscodeUserSettingsPath()).toContain(expected);
  });
});
```

## Consequences

### Positive

- **Fast test execution** — Bun's native runner starts in milliseconds and executes TypeScript directly, with no transform step.
- **No additional test framework dependency** — `bun test` is built in, keeping Jest/Vitest and their transitive trees out of `devDependencies`.
- **Familiar API** — the Jest-compatible `describe`/`it`/`expect` surface and `bun test --watch` need no onboarding.
- **Fixtures are reusable** — a shared `tests/fixtures/` directory provides consistent sample data across suites.
- **Same runtime for tests and production** — no behavior discrepancies from testing in Node.js while shipping on Bun.
- **Lint-enforced test hygiene** — custom oxlint plugins catch assertion-less tests, unguarded env restores, and first-party module mocks before CI runs the suite.

### Negative

- **Fewer features than Jest/Vitest** — coverage reporting is limited to the `--coverage` flag and mock utilities are sparse next to Jest's, though snapshot testing (`toMatchSnapshot`, `toMatchInlineSnapshot`) is supported.
- **Limited community resources** — fewer Stack Overflow answers and tutorials; contributors consult Bun documentation directly.
- **One shared process** — `mock.module()` is process-global and retroactive (it patches a module for every importer, including ones that ran before the call) and not undone by `mock.restore()`, so other test files intermittently receive the mock instead of the real implementation; env writes escape into later test files the same way. Isolation is the test author's responsibility rather than the runner's — never dodge this by splitting production code into an `-impl` file, since that only changes what gets mocked, not whether the leak happens.

### Risks

- **Bun test runner API changes** — newer APIs may still evolve between minor versions.
  - **Mitigation:** the project pins a Bun version via `.prototools`; API changes surface during controlled upgrades with full suite validation.
- **Coverage reporting gaps** — `bun test --coverage` may misreport code paths, especially dynamically imported modules.
  - **Mitigation:** the 99.5% threshold is enforced on total line coverage, not per-file, and critical modules (engine, formats) are tested thoroughly regardless of the aggregate.
- **Cross-file pollution from shared process state** — leaked env vars, leaked spies, and writes to real user-scope paths (`~/.config/Code/User/settings.json`, `%APPDATA%`, `~/.cursor/`, `~/.config/opencode/`) produce order-dependent flakes that pass on a PR run and fail after merge with identical code. `Bun.env.NODE_ENV` left unset instead of set to `"test"` before Sentry initializes is the same class of leak — the SDK sets `enabled: Bun.env.NODE_ENV !== "test"`.
  - **Mitigation:** `restoreEnv()` for every env capture, `try/finally` around inline spies, and an `os.homedir()` spy that keeps writes inside a `mkdtemp` directory; `test-isolation/no-bare-env-restore` blocks the env variant at lint time.
- **Platform-specific hangs and timeouts** — an external SDK instance left open keeps Bun's event loop alive on Linux and hangs `bun test` after every test passes, while slow Windows CI filesystems let large fixtures blow the per-test timeout and kill the staging subprocess (`git add . failed (exit 143)`, where 143 = 128 + SIGTERM). Neither reproduces on macOS or locally.
  - **Mitigation:** close SDK instances in `afterEach`, inject small thresholds instead of generating large fixtures, and cap every CI job with `timeout-minutes` (10 minutes for `code-pull-request.yml`).

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-005/test-mirrors-src`: scans `src/` and verifies a corresponding `.test.ts` file exists in `tests/`. Severity: `error`.
- **oxlint plugin** `bun-test/expect-expect` (`lint/expect-expect.ts`): enabled for `tests/**/*.test.ts`, it fails the build for any runnable `test()`/`it()` (including `test.skipIf(...)()` and `test.each(...)()`) whose body contains no `expect()` call, while ignoring `test.skip` and `test.todo`. oxlint's built-in `jest/expect-expect` recognizes only `jest`/`vitest` imports, so it does not cover `bun:test` — this plugin fills that gap.
- **oxlint plugin** `test-isolation/no-bare-env-restore` (`lint/no-bare-env-restore.ts`): enabled for `tests/**/*.test.ts`, it fails the build for any `Bun.env.NAME = <identifier>` or `process.env.NAME = <identifier>` assignment whose identifier was itself captured from an env read earlier in the same file (e.g. `const originalHome = Bun.env.HOME`). Tracking the capture rather than a naming convention such as `original*` is what separates a restore from an override — both are spelled alike, so `Bun.env.HOME = tempDir` is deliberately left alone, as is computed access (`Bun.env[key]`), which is the shape of the `restoreEnv` helper itself.
- **oxlint plugin** `test-mocking/no-first-party-module-mock` (`lint/no-first-party-module-mock.ts`): enabled for `tests/**/*.test.ts`, it fails the build for any `mock.module()` whose specifier is relative and carries a `src` path segment, while leaving third-party specifiers (`inquirer`, `node:readline`) alone. oxlint is the right layer for this Don't: the call is syntax-detectable from its specifier, and because `mock.module` is process-global and retroactive, an instance in one file corrupts files that never mention it — a defect no file-by-file review can see. Each plugin file MUST declare a `meta.name` no other plugin uses; a duplicate name silently drops the later file's rules, and oxlint then rejects the config with "Rule not found in plugin".
- All three plugins are registered via `jsPlugins` in `.oxlintrc.json` and run as part of `bun run lint` (and therefore `bun run validate` and CI).
- **CI pipeline**: every pull request runs `bun run validate:coverage`, which reaches the suite through the `test:coverage` script (`bun test --timeout 60000 --coverage`). Invoke the suite by script name (GEN-003) — a bare `bun test` applies Bun's 5-second default instead of the 60-second global and reports timeouts that the gate never sees. Test failures and per-test timeouts block merge, and all workflow jobs set `timeout-minutes` to prevent indefinite hangs.
- **Coverage threshold**: the `Coverage Report` job enforces a 99.5% minimum line coverage; below that it fails and the `Validate Code` gate blocks the PR.

### Manual Enforcement

Code reviewers MUST verify:

1. New source files have corresponding test files, and every test asserts with `expect()` — no smoke test that merely calls a function. "Does not throw" is spelled `expect(() => fn()).not.toThrow()` or `await expect(promise).resolves.toBeUndefined()`, never a bare invocation with no assertion.
2. Filesystem work happens in temp directories (no hardcoded paths), and both temp directories and external SDK instances (servers, clients, transports) are cleaned up in `afterEach`/`afterAll`, with SDK lifecycles managed in hooks rather than test bodies.
3. Temp repos that call `git commit` configure `user.email` and `user.name` locally first.
4. HTTP mocking saves `globalThis.fetch` and restores it directly in `afterEach` (`mock.restore()` does not undo a direct assignment); first-party mocking uses `import * as mod` + `spyOn`, restored via `mock.restore()`, with no production module split into an `-impl` file to dodge `mock.module` leakage.
5. Inline `spyOn`/`mockImplementation` usage wraps the spy lifecycle in `try/finally` so `mockRestore()` runs even when assertions fail.
6. Threshold tests inject a small value rather than generating fixtures large enough to trip the production default, and no per-test timeout override is shorter than the global `--timeout 60000`.
7. Shared test helpers under `tests/**` that are not `*.test.ts` files (e.g. `tests/integration/cli-harness.ts`, `tests/test-utils.ts`) restore environment variables via `restoreEnv` for every capture (`NODE_ENV`, `GIT_CONFIG_GLOBAL`, `HOME`, and any other `Bun.env.X`/`process.env.X` read) — `test-isolation/no-bare-env-restore` is scoped to `tests/**/*.test.ts` and does not cover them, yet a leak from a shared helper reaches every test that imports it.

## References

- [Bun test runner documentation](https://bun.sh/docs/cli/test)
- [ARCH-001 — Command Structure](./ARCH-001-command-structure.md) — In-process execution enables testing commands directly without process spawning
- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — Third-party dependencies introduce runtime behaviors (like event loop retention) that must be accounted for in test teardown
