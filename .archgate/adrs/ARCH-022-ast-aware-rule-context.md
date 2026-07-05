---
id: ARCH-022
title: AST-Aware Rule Context
domain: architecture
rules: true
files:
  - "src/engine/**"
  - "src/formats/rules.ts"
  - "src/helpers/rules-shim.ts"
---

## Context

`RuleContext` (`src/formats/rules.ts`, mirrored in `src/helpers/rules-shim.ts` for `.rules.ts` authors) is the only interface a `.rules.ts` file has to inspect a target project. Today it exposes exclusively text/regex/glob primitives: `glob`, `grep`, `grepFiles`, `readFile`, `readJSON`, and `report`. There is no structural, syntax-aware inspection capability.

This is a real limitation, visible in the project's own rules. `ARCH-004/no-barrel-files` implements `isBarrelFile()` as a line-stripping heuristic — it strips comments and pattern-matches each remaining line to guess whether a file "only re-exports," rather than checking whether the file's top-level statements are actually `ExportNamedDeclaration`/`ExportAllDeclaration` nodes. `ARCH-008`'s option-shape rules (`use-add-option-for-choices`, `use-add-option-for-arg-parser`) regex-match `.option(...)` call text to detect a specific three-argument call shape. Both are exactly the class of check that is fragile with regex — multi-line calls, incidental whitespace, string escaping inside arguments — and would be direct and robust with a parsed AST (e.g., "does this file's only top-level statements have type `ExportNamedDeclaration`?" or "does this `CallExpression` targeting `.option()` have a third argument of type `ArrowFunctionExpression`?").

The codebase already parses an AST, but only defensively. `src/engine/rule-scanner.ts` uses `meriyah` (`parseModule`, currently a `devDependency`) to sandbox `.rules.ts` source files themselves before they execute: `Bun.Transpiler({ loader: "ts" }).transformSync(source)` strips TypeScript syntax, then `parseModule()` produces an ESTree-shaped tree that `scanRuleSource()`/`scanImportedRuleSource()` walk to block banned imports (`BANNED_MODULES`), dangerous `Bun.*` property access (`BLOCKED_BUN_PROPS = spawn, spawnSync, write, $, file`), `eval`/`Function`, non-literal dynamic `import()`, and `globalThis`/`process.env` mutation. This capability is private to `rule-scanner.ts` — it has no exported "parse this source" primitive, the `parseModule()` call is duplicated inline across both scanning functions, and none of it is reachable from `RuleContext`.

**Alternatives considered for adding multi-language structural inspection:**

- **Per-language native tree-sitter bindings** (`tree-sitter` + `tree-sitter-python`, `tree-sitter-ruby`, etc.) — Gives a single, uniform node interface (`{type, children, text, startPosition}`) across every supported language, which is genuinely attractive. Rejected because these are native Node addons distributed as prebuilt binaries per OS/architecture. This is precisely the supply-chain and install-size profile [ARCH-006](./ARCH-006-dependency-policy.md) exists to prevent, multiplied by one binary matrix per supported language, and it does not fit the CLI's single-file `bun build --compile` distribution model.
- **WASM tree-sitter grammars** (`web-tree-sitter` + a `.wasm` grammar per language) — Avoids the native-binary-per-platform problem since Bun has built-in `WebAssembly` support and a `.wasm` grammar is a portable data file, not a platform artifact. Deferred rather than rejected outright: it still adds a new production dependency and one or more multi-megabyte bundled assets requiring ARCH-006 review, and it is unverified whether `bun build --compile` can embed and load a `.wasm` grammar from the compiled binary rather than the filesystem. If Python/Ruby usage under this ADR's approach proves insufficient, this is the most likely next escalation and should be evaluated in a follow-up ADR once the two open questions above are answered.
- **Shelling out to the target project's own linter** (invoke `pylint`/`rubocop` and parse their JSON output) — Rejected as the general mechanism: it depends on the _target_ project having that tooling installed and configured, which cannot be assumed, and it couples `RuleContext` to third-party CLI output formats rather than to a language's own AST representation.
- **Do nothing; keep structural checks as regex heuristics** — Rejected because it does not scale past superficial patterns (see the ARCH-004/ARCH-008 examples above) and blocks any Python/Ruby structural check entirely, since regex-over-text has no notion of syntax at all for those languages.

For Archgate specifically, the CLI already ships as a single compiled binary with a small, deliberately vetted dependency tree ([ARCH-006](./ARCH-006-dependency-policy.md)) and already has a working, in-process AST parser for TypeScript/JavaScript sitting unused outside of `rule-scanner.ts`. The lowest-cost path that adds real capability without expanding the dependency tree is to expose that existing parser through `RuleContext`, and to reach Python/Ruby by invoking each language's own standard-library AST facility as a subprocess — capability that ships with the interpreter itself, requiring zero new packages.

## Decision

`RuleContext` MUST expose a single method:

```typescript
ast(path: string, language: "typescript" | "javascript" | "python" | "ruby"): Promise<AstNode>;
```

This method dispatches internally based on `language`, and the dispatch mechanism MUST be invisible to rule authors — a `.rules.ts` file calls `ctx.ast(path, language)` and receives a parsed tree or an exception; it never sees which mechanism produced it.

- **`"typescript"` / `"javascript"`** MUST reuse the in-process `meriyah` parser already used by `src/engine/rule-scanner.ts`. No subprocess is spawned for this branch. The inline `parseModule()` invocation currently duplicated in `scanRuleSource()` and `scanImportedRuleSource()` MUST be factored into a shared, exported parse helper that both `rule-scanner.ts` and the new `ctx.ast()` implementation call, rather than introducing a third inline copy.
- **`"python"` / `"ruby"`** MUST invoke the language's own standard-library AST facility as a subprocess via `Bun.spawn`, per [ARCH-007](./ARCH-007-cross-platform-subprocess-execution.md): Python's built-in `ast` module (`<probed-python> -c "..."`, serializing the tree to JSON), Ruby's built-in `Ripper` (`ruby -rripper -rjson -e "..."`, serializing its s-expression output to JSON). `<probed-python>` is whichever candidate name (`python3`/`python`) the interpreter availability probe below resolved for this platform — never hardcoded. No third-party parser, native binding, or WASM grammar is introduced for these languages under this decision.

**Guardrail ordering — this is the core architectural constraint of this ADR.** A rule author MUST NEVER be able to reach `Bun.spawn`, `child_process`, or any other subprocess/filesystem primitive directly; `ctx.ast()` is the only door, exactly as `glob`/`grep`/`readFile` are today, and this is consistent with the sandbox `rule-scanner.ts` already enforces on `.rules.ts` source (which explicitly blocks `Bun.spawn` and `Bun.spawnSync` from rule code). All of the following MUST execute inside `createRuleContext()` in `src/engine/runner.ts`, in this order, before any subprocess is spawned:

1. **Path safety** — the requested `path` MUST pass through the same `safePath()` sandboxing already applied to `readFile`/`glob` (no traversal outside `scopedFiles`, no symlink escapes).
2. **Language plausibility check** — the file's extension and/or leading content MUST be sanity-checked against the requested `language` before any interpreter is invoked on it. A rule calling `ctx.ast("config.json", "python")` MUST fail this check rather than hand arbitrary file content to a Python interpreter.
3. **Interpreter availability probe** — for `"python"`/`"ruby"`, an availability check (e.g. `Bun.spawn([candidate, "--version"])` wrapped in `try/catch`, following the exact pattern `isClaudeCliAvailable()` uses in ARCH-007) MUST run before the real invocation. `python3` is not a universal PATH alias on Windows (the common installer exposes `python`, not `python3`); the probe MUST try platform-appropriate candidate executable names in order (e.g. `python3` then `python` on non-Windows, `python` then `python3` on Windows, using [ARCH-009](./ARCH-009-platform-detection-helper.md)'s `isWindows()`) and use the first one that resolves for both the probe and the real invocation. This probe result MUST be cached once per `check` invocation, not re-run per file.
4. **Guarded invocation** — the actual `Bun.spawn` call MUST use array-based arguments only, per ARCH-007, with no shell interpolation of file contents or paths.

**Failure semantics.** `ctx.ast()` MUST throw — it MUST NOT return `null` or any other sentinel — both when the required interpreter is unavailable and when the target file fails to parse. This is a deliberate choice, not an oversight: this ADR does not introduce any new error-boundary or exit-code behavior, and none is needed, because `ctx.ast()`'s failure mode composes directly with contracts `src/engine/runner.ts` and `src/engine/reporter.ts` already implement. Every rule's `check(ctx)` call already runs inside a per-rule `try/catch` (`runner.ts`, the loop over `Object.entries(ruleSet.rules)`) that isolates a thrown error to that single rule — other ADRs and rules in the same `check` run continue and report normally. `reporter.ts`'s `getExitCode()` already reserves exit code `2` specifically for rule execution errors, distinct from exit `1` (ADR violations found) and exit `0` (pass). A thrown `ctx.ast()` error therefore surfaces as a visible, correctly-categorized failure through machinery that already exists; a `null` return would instead let a rule silently no-op and report as a false "0 violations," masking a real capability gap as a pass. The exit-code/reporter distinction is coarse by design (exit `2` means "a rule could not complete," full stop) — the two throw cases MUST still be distinguishable from each other in the thrown error's message text (e.g. "Python interpreter not found on PATH" vs. "Failed to parse `<path>`: `<parser error>`"), since a user reading `check` output needs to tell "this environment can't run this rule" apart from "this specific file has a syntax error" even though both land on the same exit code.

**Explicit non-goal: cross-language AST shape unification.** `ctx.ast()` unifies the call site and the failure contract across languages. It does NOT unify the shape of the returned tree. TypeScript/JavaScript returns ESTree-shaped nodes (via `meriyah`); Python returns whatever the standard `ast` module's own node schema produces; Ruby returns `Ripper`'s native s-expression shape. A rule author writing a Python check and a rule author writing a Ruby check are working against two different, language-native grammars, and must know the target language's own AST vocabulary. This ADR accepts that trade explicitly in exchange for avoiding the dependency and distribution cost of a unifying parser (see the tree-sitter alternatives above); it is not a limitation to be silently discovered later.

**Scope.** This ADR covers the `RuleContext.ast()` method signature, its internal dispatch and guardrail ordering, and its failure semantics. It does not cover: which languages ship in which release, rollout sequencing, or example rule authoring guidance — those are product decisions tracked separately, not architectural constraints.

## Do's and Don'ts

### Do

- **DO** implement `ast(path, language)` as a single method on `RuleContext` with dispatch entirely internal to `createRuleContext()` in `src/engine/runner.ts`
- **DO** reuse the existing `meriyah`-based parser for `"typescript"`/`"javascript"`, factoring the duplicated `parseModule()` call in `rule-scanner.ts` into one shared helper used by both the scanner and `ctx.ast()`
- **DO** run the path-safety, language-plausibility, interpreter-availability, and guarded-invocation checks in exactly that order, before any subprocess is spawned, for the `"python"`/`"ruby"` branches
- **DO** use `Bun.spawn` with array-based arguments for the Python/Ruby subprocess invocations, per [ARCH-007](./ARCH-007-cross-platform-subprocess-execution.md)
- **DO** cache the interpreter-availability probe once per `check` invocation
- **DO** throw from `ctx.ast()` on missing interpreter or parse failure, and let it propagate to the existing per-rule `try/catch` in `runner.ts`
- **DO** document, in the type signature or accompanying JSDoc, that the returned node shape differs per language

### Don't

- **DON'T** expose `Bun.spawn`, `child_process`, or any other raw subprocess primitive on `RuleContext` — `ctx.ast()` is the only sanctioned path to language tooling
- **DON'T** return `null` or any other silent-failure sentinel from `ctx.ast()` — this would hide a capability gap as a false passing check
- **DON'T** invoke the Python/Ruby interpreter on a file before the language-plausibility check has run
- **DON'T** add `tree-sitter`, `web-tree-sitter`, or any other new production dependency under this decision — Python/Ruby support MUST use only the interpreter's own standard-library AST facility
- **DON'T** attempt to normalize Python/Ruby output into an ESTree-like shape as part of this ADR — that is explicitly out of scope
- **DON'T** re-probe interpreter availability on every file — cache it per `check` run

## Consequences

### Positive

- **Structural checks become possible for TypeScript/JavaScript without new dependencies** — `ctx.ast()`'s TS/JS branch reuses `meriyah`, already present in the tree, closing the gap that forces `ARCH-004` and `ARCH-008` into regex heuristics today.
- **Python/Ruby structural checks become possible with zero new production dependencies** — using each language's own standard-library AST facility means no native binding, no WASM asset, and no ARCH-006 dependency review is required to ship this.
- **Consistent, auditable sandbox boundary** — extending, rather than bypassing, the existing `rule-scanner.ts`/`RuleContext` sandboxing model means the security posture of `.rules.ts` execution does not change in kind, only in the set of capabilities exposed through the same narrow door.
- **Failure visibility reuses proven machinery** — no new exit code, no new reporter branch, no new error-boundary design; `ctx.ast()`'s throw-on-failure behavior rides on `runner.ts`'s existing per-rule isolation and `reporter.ts`'s existing exit-code-2 category.
- **Incremental adoption** — TS/JS support ships using zero new capability surface beyond what already exists internally; Python/Ruby support can follow independently since the guardrail and failure-semantics design is identical for both.

### Negative

- **No cross-language AST vocabulary** — a rule author supporting both Python and Ruby structural checks must learn two unrelated grammars (the standard `ast` module's schema and `Ripper`'s s-expression shape), unlike a tree-sitter-based approach which would have offered one vocabulary across languages.
- **Environmental dependency for Python/Ruby rules** — `ctx.ast()` for those languages depends on a Python or Ruby interpreter being present on the machine running `archgate check`. This is not a package the project controls or bundles; a rule targeting Python will correctly fail (via the throw-based contract above) on a machine without a Python interpreter, which is a real limitation, not just a theoretical one.
- **`meriyah` gains a runtime execution path it did not previously have** — today `meriyah` runs only inside the `check` engine's rule-scanning step; after this decision it also runs, via `ctx.ast()`, at rule-execution time inside the compiled binary shipped to end users. This does not require a new ARCH-006 review (no new package is added), but it changes the package's practical scope from "internal scanning tool" to "runtime capability," and maintainers should be aware of that shift when evaluating future `meriyah` upgrades.
- **Language-specific grammar drift is inherited, not controlled** — standard-library AST facilities are not immune to internal restructuring across language versions (e.g., Python's `ast` module deprecating `ast.Str`/`ast.Num` in favor of `ast.Constant` in 3.8). `ctx.ast()`'s own contract does not change when this happens, but a rule author's language-specific pattern matching can still break; this ADR does not attempt to insulate rule authors from upstream grammar changes.

### Risks

- **A future contributor bypasses the guardrail ordering and spawns the Python/Ruby interpreter directly from inside a `ctx.ast()` code path without the path-safety or language-plausibility checks.**
  - **Mitigation:** the four-step guardrail ordering in the Decision section is mandatory and reviewable; `rule-scanner.ts`'s existing `BLOCKED_BUN_PROPS` sandbox continues to prevent `.rules.ts` files themselves from reaching `Bun.spawn`, so the only code path capable of spawning a subprocess for this feature is `createRuleContext()` itself, which code review MUST verify follows the ordering exactly.
- **Interpreter-version skew between the machine authoring a Python/Ruby rule and machines running `archgate check` produces inconsistent AST shapes for the same source file.**
  - **Mitigation:** this is inherent to shelling out to system-installed interpreters rather than bundling a pinned parser version, and is accepted as part of choosing Option A over tree-sitter. Rule authors targeting Python/Ruby structural checks should keep patterns tolerant of minor version-specific node shape differences, and the interpreter-availability probe surfaces the interpreter's version so this can be logged for diagnosis.
- **The duplicated inline `parseModule()` calls in `rule-scanner.ts` are not factored out before `ctx.ast()`'s TS/JS branch is implemented, leaving three near-identical parse call sites instead of two.**
  - **Mitigation:** the Decision section explicitly mandates factoring this into one shared helper as part of implementing this ADR, not as optional cleanup.

## Compliance and Enforcement

### Automated Enforcement

`ctx.ast()` has shipped, and this ADR now carries `rules: true` with three companion checks in `ARCH-022-ast-aware-rule-context.rules.ts`:

- **`ast-guardrail-ordering`** — parses `src/engine/runner.ts` via `ctx.ast()` itself (dogfooding the capability this ADR introduces) and verifies the `ast()` method inside `createRuleContext()` invokes the four guardrail markers — `safePath`, `AST_LANGUAGE_EXTENSIONS`, `probeInterpreter`, `runAstSubprocess` — each present and in exactly that order.
- **`no-unsanctioned-engine-subprocess`** — flags any `Bun.spawn`/`Bun.spawnSync` call in `src/engine/` outside the sanctioned helpers (`ast-support.ts` for `ctx.ast()`, `git-files.ts` for git), and bans `child_process` imports in the engine entirely, mirroring how `ARCH-007/no-bun-shell` scans for banned subprocess patterns.
- **`single-ast-method`** — verifies `RuleContext` (in `src/formats/rules.ts` and the generated shim in `src/helpers/rules-shim.ts`) declares exactly one `ast(path, language)` signature and no per-language variants (`pythonAst()`, `rubyAst()`, etc.).

### Manual Enforcement

Code reviewers MUST verify, for any PR implementing or modifying `ctx.ast()`:

1. `RuleContext` exposes exactly one `ast(path, language)` method — no per-language method variants (`ctx.pythonAst()`, `ctx.rubyAst()`, etc.)
2. The four-step guardrail ordering (path safety, language plausibility, interpreter probe, guarded invocation) is implemented in full and in order for the `"python"`/`"ruby"` branches
3. No new production dependency appears in `package.json` as part of this feature
4. `ctx.ast()` throws (never returns `null` or another sentinel) on missing interpreter or parse failure
5. The `meriyah` `parseModule()` call is shared between `rule-scanner.ts` and the `ctx.ast()` TS/JS branch, not duplicated a third time
6. No subprocess invocation for this feature uses `Bun.$` or any shell-interpolated command string, per [ARCH-007](./ARCH-007-cross-platform-subprocess-execution.md)

### Exceptions

Any proposal to add a bundled multi-language parser (tree-sitter, WASM grammars, or otherwise) to broaden `ctx.ast()`'s guarantees beyond this ADR's scope MUST be documented as a separate ADR, reviewed against [ARCH-006](./ARCH-006-dependency-policy.md)'s dependency-approval process, and approved by the project maintainer before implementation begins.

## References

- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — This decision requires no new production dependency; Python/Ruby support relies entirely on system-installed interpreters rather than an approved-list addition
- [ARCH-007 — Cross-Platform Subprocess Execution](./ARCH-007-cross-platform-subprocess-execution.md) — Governs the `Bun.spawn` array-argument pattern used for the Python/Ruby subprocess branches
- [ARCH-004 — No Barrel Files or Re-Exports](./ARCH-004-no-barrel-files.md) — The `isBarrelFile()` line-heuristic is a concrete example of the regex-over-text limitation this ADR addresses for TypeScript/JavaScript
- [ARCH-008 — Typed Command Options](./ARCH-008-typed-command-options.md) — The `.option()` call-shape regex checks are a second concrete example of the same limitation
- `src/engine/rule-scanner.ts` — The existing `meriyah`-based AST sandbox this decision extends; note this mechanism itself is not currently documented by a formal ADR, which is a documentation gap outside this ADR's scope
- [Python `ast` module documentation](https://docs.python.org/3/library/ast.html)
- [Ruby `Ripper` documentation](https://docs.ruby-lang.org/en/master/Ripper.html)
- [meriyah (npm)](https://www.npmjs.com/package/meriyah)
