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

Use Bun's built-in test runner (`bun test`) for all tests. Test files go in `tests/` mirroring the `src/` directory structure. Fixtures go in `tests/fixtures/`. Target 80% code coverage.

**Key conventions:**

1. **Directory structure mirrors `src/`** — A source file at `src/engine/runner.ts` has its test at `tests/engine/runner.test.ts`. This makes tests discoverable by convention.
2. **Fixtures in `tests/fixtures/`** — Sample ADR files and mock codebases live in a shared fixtures directory. Fixtures are reusable across test suites.
3. **Temp directories for filesystem tests** — Tests that write files use `mkdtemp` for isolation. Temp directories are cleaned up in `afterEach` or `afterAll`.
4. **Test file naming** — Test files use the `.test.ts` suffix: `<module-name>.test.ts`.
5. **Coverage target: 80%** — Not enforced in CI yet, but serves as a guideline. Critical paths (engine, formats) should have higher coverage.

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
- **When mocking `fetch` in tests, assign directly to `globalThis.fetch`** — use `globalThis.fetch = mockFn as unknown as typeof fetch`. Restore in `afterEach` via `mock.restore()` (from `bun:test`) or by reassigning the original reference before the test.

### Don't

- Don't test private implementation details — test the public API of each module
- Don't depend on network access in unit tests
- Don't leave temp files after test runs
- **Don't leave external SDK instances open after tests** — instances from libraries such as `@modelcontextprotocol/sdk` hold internal references (e.g., `AjvJsonSchemaValidator` backed by `ajv`) that keep Bun's event loop alive on Linux, causing `bun test` to hang indefinitely after all tests complete even though every test passes. Always call the cleanup method in `afterEach`.
- **Don't rely on globally-configured git identity in temp git repos** — always set `user.email` and `user.name` locally in any repo that makes commits. Omitting this works locally (where developers have global git config) but fails silently in CI, producing a cryptic `ShellPromise` error with no indication that git identity is the cause.
- Don't skip tests without a tracking issue
- Don't import test utilities from `node:test` — use Bun's built-in `bun:test` module
- **Don't use `mock.module("node:fetch", ...)` to intercept HTTP fetch calls** — in Bun, the runtime fetch is `globalThis.fetch` and `mock.module` targeting `node:fetch` does not intercept it. The mock silently has no effect: the real network is hit, making tests non-deterministic and dependent on external services. Assign `globalThis.fetch` directly instead (see Do's above).

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

### Good Example — External SDK Cleanup

```typescript
// tests/mcp/resources.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResources } from "../../src/mcp/resources";

describe("registerResources", () => {
  let tempDir: string;
  let server: McpServer;

  // GOOD: lifecycle managed in beforeEach/afterEach, not inside test bodies
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-mcp-res-test-"));
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    server = new McpServer({ name: "test", version: "0.0.0" });
  });

  afterEach(async () => {
    await server.close(); // GOOD: releases internal validator references
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("does not throw when registering resources", () => {
    expect(() => registerResources(server, tempDir)).not.toThrow();
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

// BAD: SDK instance created inside test body — no guaranteed cleanup path
it("registers resources", () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  // server.close() never called — event loop held open on Linux
  expect(() => registerResources(server, tempDir)).not.toThrow();
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

- **Bun test runner API changes** — Although Bun is past 1.0 (currently 1.3.8), some newer APIs may still evolve between minor versions. Test runner behavior or API may change.
  - **Mitigation:** The project pins a specific Bun version via `.prototools` (currently 1.3.8). Test runner API changes are caught during controlled Bun upgrades with full test suite validation.
- **Coverage reporting gaps** — `bun test --coverage` may not report accurate coverage for all code paths, especially for dynamically imported modules.
  - **Mitigation:** Coverage is a guideline (80% target), not a hard gate. Critical modules (engine, formats) are tested thoroughly regardless of coverage numbers.
- **Third-party SDK event loop retention** — External SDK instances that hold internal resource references (e.g., `AjvJsonSchemaValidator` inside `@modelcontextprotocol/sdk`) keep Bun's event loop alive on Linux after all tests complete, causing `bun test` to hang indefinitely. This does not surface on macOS (event loop drains normally there), making it a Linux-CI-only failure that is hard to reproduce locally.
  - **Mitigation:** Always manage SDK lifecycle in `beforeEach`/`afterEach` and call the cleanup method (`close()`, `destroy()`, `disconnect()`) in `afterEach`. Add `timeout-minutes` to CI jobs as a safety net — the `code-pull-request.yml` job is set to 10 minutes to cap any future regressions.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-005/test-mirrors-src`: Scans all source files in `src/` and verifies a corresponding `.test.ts` file exists in `tests/`. Severity: `error`.
- **CI pipeline**: `bun test --timeout 60000` runs on every pull request. Test failures and per-test timeouts block merge. All workflow jobs have `timeout-minutes` set to prevent indefinite hangs.

### Manual Enforcement

Code reviewers MUST verify:

1. New source files have corresponding test files
2. Tests use temp directories for filesystem operations (no hardcoded paths)
3. Tests clean up after themselves (`afterEach`/`afterAll` cleanup) — including both temp directories and external SDK instances
4. Tests that instantiate SDK objects (servers, clients, connections) manage their lifecycle in `beforeEach`/`afterEach`, not inside individual test bodies
5. Tests that call `git commit` on a temp repo configure `user.email` and `user.name` locally before committing
6. Tests that mock HTTP fetch assign `globalThis.fetch` directly — no `mock.module("node:fetch", ...)` usage

## References

- [Bun test runner documentation](https://bun.sh/docs/cli/test)
- [ARCH-001 — Command Structure](./ARCH-001-command-structure.md) — In-process execution enables testing commands directly without process spawning
- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — Third-party dependencies introduce runtime behaviors (like event loop retention) that must be accounted for in test teardown
