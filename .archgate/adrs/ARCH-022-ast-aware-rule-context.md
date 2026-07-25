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

`RuleContext` (`src/formats/rules.ts`, mirrored in `src/helpers/rules-shim.ts` for `.rules.ts` authors) is a rule's only interface for inspecting a target project, and its primitives are text-only: `glob`, `grep`, `grepFiles`, `readFile`, `readJSON`, `report`.

Without syntax-aware inspection, structural checks degrade into regex heuristics — `ARCH-004/no-barrel-files` strips comments and pattern-matches lines to guess "only re-exports" instead of asking whether the top-level statements are `ExportNamedDeclaration`/`ExportAllDeclaration` nodes, and `ARCH-008`'s `use-add-option-for-choices` / `use-add-option-for-arg-parser` regex-match `.option(...)` text instead of asking whether that `CallExpression` has an `ArrowFunctionExpression` third argument. Multi-line calls, incidental whitespace, and string escaping all break these; a parsed AST answers them directly.

An AST parser already exists in the codebase, but defensively and privately. `src/engine/rule-scanner.ts` sandboxes `.rules.ts` source before it executes: `Bun.Transpiler({ loader: "ts" }).transformSync(source)` strips TypeScript syntax, then `meriyah`'s `parseModule()` produces an ESTree tree that `scanRuleSource()`/`scanImportedRuleSource()` walk to block banned imports (`BANNED_MODULES`), dangerous `Bun.*` property access (`BLOCKED_BUN_PROPS = spawn, spawnSync, write, $, file`), `eval`/`Function`, non-literal dynamic `import()`, and `globalThis`/`process.env` mutation. It exports no reusable "parse this source" primitive, duplicates the `parseModule()` call inline across both scanning functions, and is unreachable from `RuleContext`.

**Alternatives considered for adding multi-language structural inspection:**

- **Per-language native tree-sitter bindings** (`tree-sitter` + `tree-sitter-python`, `tree-sitter-ruby`, etc.) — one uniform node interface (`{type, children, text, startPosition}`) across languages, but rejected: native Node addons shipped as prebuilt per-OS/architecture binaries are exactly the supply-chain and install-size profile [ARCH-006](./ARCH-006-dependency-policy.md) exists to prevent, multiplied by one binary matrix per language, and they do not fit single-file `bun build --compile` distribution.
- **WASM tree-sitter grammars** (`web-tree-sitter` + a `.wasm` grammar per language) — deferred, not rejected: portable and Bun supports `WebAssembly`, but it still adds a production dependency plus multi-megabyte bundled assets requiring ARCH-006 review, and whether `bun build --compile` can embed and load a `.wasm` grammar from the compiled binary (rather than the filesystem) is unverified. The most likely next escalation, via a follow-up ADR, if Python/Ruby coverage proves insufficient.
- **Shelling out to the target project's own linter** (`pylint`/`rubocop` JSON output) — rejected as the general mechanism: it assumes the _target_ project has that tooling installed and configured, and couples `RuleContext` to third-party CLI output formats rather than a language's own AST.
- **Do nothing; keep structural checks as regex heuristics** — rejected: it does not scale past superficial patterns (see above) and blocks Python/Ruby structural checks entirely, since regex-over-text has no notion of their syntax.

The lowest-cost path that adds real capability without expanding the CLI's deliberately small dependency tree ([ARCH-006](./ARCH-006-dependency-policy.md)) is to expose the existing in-process parser through `RuleContext`, and to reach Python/Ruby via each language's own standard-library AST facility as a subprocess — capability that ships with the interpreter, requiring zero new packages.

## Decision

`RuleContext` MUST expose exactly one AST method, catch-all signature:

```typescript
ast(path: string, language: AstLanguage, opts?: AstOptions): Promise<AstNode>;
// AstLanguage = "typescript" | "javascript" | "python" | "ruby"
// AstOptions  = { rev?: "base"; comments?: boolean }
```

Dispatch on `language` is internal and MUST be invisible to rule authors: a rule gets a parsed tree or an exception, never the mechanism.

- **`"typescript"` / `"javascript"`** MUST reuse the in-process `meriyah` parser, spawning no subprocess. `rule-scanner.ts`'s `parseModule()` call, duplicated inline in `scanRuleSource()`/`scanImportedRuleSource()`, MUST be factored into one shared exported helper (`parseTsOrJsSource`, `src/engine/js-parser.ts`) used by both the scanner and `ctx.ast()` — never a third inline copy.
- **`"python"` / `"ruby"`** MUST invoke the language's own standard-library AST facility as a subprocess via `Bun.spawn`, per [ARCH-007](./ARCH-007-cross-platform-subprocess-execution.md): Python's `ast` module (`<probed-python> -I -c "..."` → JSON), Ruby's `Ripper` (`ruby -rripper -rjson -e "..."` → JSON s-expression). `<probed-python>` comes from the availability probe — never hardcoded. The Python `-I` is mandatory: without it `python -c` puts the target project's cwd on `sys.path`, where a planted `ast.py`/`json.py` executes on stdlib import. Ruby's load path has excluded the cwd since 1.9.2, so it needs no equivalent flag. No third-party parser, native binding, or WASM grammar is introduced.

**Guardrail ordering — this ADR's core architectural constraint.** Rule code MUST NEVER reach `Bun.spawn`, `child_process`, or any other subprocess/filesystem primitive; `ctx.ast()` is the only door, exactly as `glob`/`grep`/`readFile` are. All four MUST execute inside `createRuleContext()` in `src/engine/runner.ts`, before any subprocess is spawned, in this order: **`safePath` → `AST_LANGUAGE_EXTENSIONS` → `probeInterpreter` → `runAstSubprocess`**.

1. **Path safety** — `safePath()`, the same sandbox as `readFile`/`glob`: no traversal outside `scopedFiles`, no symlink escapes. `assertNoSymlinkInPath()` (`src/engine/safe-path.ts`) MUST reject a link at **every component below the project root**, not just the leaf (a linked `<root>/docs` passes lexical containment and a leaf `lstat` while the OS reads outside). Two deliberate limits: components at or above the root are NOT inspected (macOS's temp prefix `/var` → `/private/var` is itself a link and would reject every temp root), and each component is tested by boolean `lstat`, never compared to `realpath`, which case-canonicalizes on Windows/macOS and would reject legitimate case-mismatched paths.
2. **Language plausibility check** — extension and/or leading content MUST be checked against the requested `language` (`AST_LANGUAGE_EXTENSIONS`) before any interpreter is invoked; `ctx.ast("config.json", "python")` MUST fail here rather than hand arbitrary content to a Python interpreter.
3. **Interpreter availability probe** — `probeInterpreter` MUST run `Bun.spawn([candidate, "--version"])` in `try/catch` (the pattern `isClaudeCliAvailable()` uses in ARCH-007) before the real invocation, trying candidates in order — `python3` then `python` off Windows; `python`, `python3`, then the `py` launcher on Windows, branching on [ARCH-009](./ARCH-009-platform-detection-helper.md)'s `isWindows()` — and use the first that resolves for both the probe and the real invocation. (`python3` is not a universal Windows PATH alias; the python.org installer registers `py` even when "Add python.exe to PATH" is unchecked.) The result MUST be cached once per `check` invocation, never re-probed per file.
4. **Guarded invocation** — `runAstSubprocess` MUST use array-based arguments only, per ARCH-007, with no shell interpolation of file contents or paths.

**Failure semantics.** `ctx.ast()` MUST throw — never return `null` or any other sentinel — in four cases: interpreter unavailable, parse failure, and under `{ rev: "base" }` no base revision resolved (run without `--base`) or the path absent at the base (added since). A sentinel would let a rule silently no-op and report a false "0 violations", masking a capability gap as a pass. No new error boundary or exit code is needed: `runner.ts`'s per-rule `try/catch` around each `check(ctx)` (the loop over `Object.entries(ruleSet.rules)`) isolates the throw to that rule while others continue, and `reporter.ts`'s `getExitCode()` already reserves exit `2` for rule execution errors, distinct from `1` (violations) and `0` (pass). That code is coarse by design ("a rule could not complete"), so the four cases MUST stay distinguishable in the thrown message text — e.g. "Python interpreter not found on PATH" vs. "Failed to parse `<path>`: `<parser error>`" vs. "needs a base revision, but none is resolved" vs. "did not exist at the base revision".

`fileAtBase()` is the one deliberate exception to the throw contract: it returns `null` for the no-base and absent-at-base cases, because "is there a base to compare against?" is ordinary control flow and a forced `try/catch` would be the worse interface.

**Base-revision access.** `RuleContext` MUST also reach a file at its **base git revision**, not just the working tree: `ast(path, language, { rev: "base" })` parses the base commit's content with the same language-native shape and throw contract, and `fileAtBase(path): Promise<string | null>` returns the raw base source (`null` per the exception above). This closes the gap [ARCH-024](./ARCH-024-rule-file-sandbox-boundary.md) exposed — base comparison is a common legitimate pattern (documentation-only waivers, no-op detection), and the lack of a sanctioned path for it is what drove rule authors to spawn git and an interpreter directly.

**The "base" is the merge base of `--base` and HEAD** — the exact commit `changedFiles` diffs against (git three-dot `ref...HEAD`), resolved once per `check` run by `getMergeBase` in `src/engine/git-files.ts` and `null` without `--base`. Base reads MUST use that same commit so a rule compares against the same point as the change set it was handed.

**Base access introduces NO new privileged path and does NOT alter the four-step guardrail ordering** — only _source acquisition_ changes:

- Git reads (`git merge-base`, `git show <mergebase>:<path>`) MUST stay in `src/engine/git-files.ts`, the sanctioned git subprocess site `no-unsanctioned-engine-subprocess` permits. No new `Bun.spawn` site, no `child_process`.
- All four guardrails still run, in order, on the original path — `safePath` (which also yields the repo-relative form `git show` needs), `AST_LANGUAGE_EXTENSIONS`, interpreter probe, guarded invocation.
- TS/JS base source goes through the same shared `parseTsOrJsSource`. Python/Ruby base content is not on disk, so `writeTempSourceFile` (`ast-support.ts`) writes it to a throwaway OS-temp file — outside the project tree, hence outside any cwd-derived load path — for the **same, unchanged** `PYTHON_AST_PROGRAM`/`RUBY_AST_PROGRAM` under the **same mandatory `-I` isolation**; `python-subprocess-isolated` is unchanged. That write MUST defeat shared-`/tmp` symlink pre-creation (an attacker planting a link at a predictable name) with a fresh `mkdtemp` directory (mode `0700`, unpredictable suffix) plus exclusive create (`wx`, mode `0600`), so the open fails rather than following a planted path.

**Comment access.** `{ comments: true }` attaches to the returned tree a `comments` array of `CommentToken` (`{ type: "line" | "block"; value: string; loc: { start, end } }`) — structured data for comment-governance rules (length, style, content) in place of line-by-line regex. Opt-in, all four languages. It MUST fold into `ast()` rather than a separate method, so it runs inside the same four-guardrail flow and `single-ast-method` stays satisfied with the catch-all signature unchanged. **No new subprocess site and no new guardrail** — only an in-process TS/JS source scan plus alternate serializer programs selected inside the same guarded invocation — so `ast-guardrail-ordering` already covers it.

- `value` has its delimiters removed (`//`, `/* … *​/`, `#`). Python has only `"line"` comments; `"""` docstrings are string expressions in the `ast` tree, NOT comments.
- **TS/JS comments come from the ORIGINAL source, not the tree** (`extractJsComments` in `js-parser.ts`), because `Bun.Transpiler` strips them before `meriyah` sees them — with the advantage that their `loc` is accurate against the original `.ts`, unlike the tree's transpiled-relative `loc`. The scan is string/template-literal aware but does NOT track regex literals, so a delimiter inside a regex literal (e.g. `/foo\/\//`) is a known blind spot, consistent with `source-positions.ts`.
- **Python comments come from `tokenize`** via `PYTHON_AST_WITH_COMMENTS_PROGRAM`; **Ruby comments from a second `Ripper.lex` pass** via `RUBY_AST_WITH_COMMENTS_PROGRAM` (neither tree carries them). Both print a `{ _tree, comments }` envelope the engine unwraps — for Ruby, `comments` rides on the sexp array as a non-index property. The Python serializer shares the base program's `convert()` preamble and the same mandatory `-I` isolation; `python-subprocess-isolated` is unchanged.
- Ruby `#` comments are `"line"` tokens; each `=begin`/`=end` region is ONE `"block"` token whose `value` is the inner content (marker lines stripped) with line endings normalized to LF, so a CRLF file yields the same value on every OS. Comment `loc` columns are converted from Ripper's byte offsets to character offsets, matching the Python/TS convention; the sexp tree's own node positions stay byte-based.
- Tokenizer/lex errors on otherwise-parseable source degrade to an empty comment list rather than failing the parse.

**Explicit non-goal: cross-language AST shape unification.** `ctx.ast()` unifies the call site and the failure contract, NOT the returned tree's shape: ESTree nodes for TypeScript/JavaScript (`meriyah`), the standard `ast` module's own schema for Python, `Ripper`'s native s-expression for Ruby. Rule authors MUST know the target language's own AST vocabulary. This trade is accepted explicitly, in exchange for avoiding the dependency and distribution cost of a unifying parser (see the tree-sitter alternatives above).

**Scope.** This ADR covers `RuleContext.ast()`'s signature, internal dispatch, guardrail ordering, and failure semantics. It does not cover which languages ship in which release, rollout sequencing, or example rule-authoring guidance — product decisions tracked separately, not architectural constraints.

## Do's and Don'ts

### Do

- **DO** implement `ast()` as a single `RuleContext` method, dispatch entirely internal to `createRuleContext()` in `src/engine/runner.ts`
- **DO** give the catch-all overload the same third parameter as the literal-language overloads — `ast(path: string, language: AstLanguage, opts?: AstOptions): Promise<AstNode>` — or a caller holding a dynamically-typed `AstLanguage` silently loses `{ rev: "base" }` and `{ comments: true }`; `single-ast-method` enforces this exact signature
- **DO** reuse the `meriyah` parser for `"typescript"`/`"javascript"`, factoring `rule-scanner.ts`'s duplicated `parseModule()` into one shared helper used by both the scanner and `ctx.ast()`
- **DO** run path safety, language plausibility, interpreter availability, and guarded invocation in exactly that order before any subprocess is spawned, with `Bun.spawn` array-based arguments ([ARCH-007](./ARCH-007-cross-platform-subprocess-execution.md)), caching the probe once per `check` invocation
- **DO** run the Python AST subprocess in isolated mode (`python -I -c ...`) — Ruby needs no equivalent, its load path having excluded the cwd since 1.9.2 — and strip a leading UTF-8 BOM in both serializers (`encoding="utf-8-sig"` / `mode: "r:bom|utf-8"`), since plain `utf-8` keeps U+FEFF and `ast.parse` rejects it
- **DO** throw from `ctx.ast()` on missing interpreter or parse failure, letting it propagate to `runner.ts`'s per-rule `try/catch`
- **DO** document, in the type signature or JSDoc, that the returned node shape differs per language
- **DO** use `ast(path, language, { rev: "base" })` or `fileAtBase()` for base comparison — never shell out to git or an interpreter from rule code ([ARCH-024](./ARCH-024-rule-file-sandbox-boundary.md)) — keeping base git reads in `src/engine/git-files.ts` and resolving the base as the merge base of `--base` and HEAD, matching `changedFiles`' `ref...HEAD` diff
- **DO** use `ast(path, language, { comments: true })` for comment-governance rules — its `comments` array is structured (`type`/`value`/`loc`) and, even for `"typescript"`, `loc` is ORIGINAL-source-accurate, unlike the tree's transpiled-relative `loc`
- **DO** mirror every `RuleContext` surface change — methods, properties, and the ambient types they reference — into the generated shim in `src/helpers/rules-shim.ts` in the same change; `rulecontext-shim-parity` fails on member-name drift, and reviewers MUST verify full signatures and JSDoc match too

### Don't

- **DON'T** expose `Bun.spawn`, `child_process`, or any other raw subprocess primitive on `RuleContext`, or read a base revision by spawning git or an interpreter from a `.rules.ts` file — exactly the escape [ARCH-024](./ARCH-024-rule-file-sandbox-boundary.md) blocks. `ctx.ast()` (with `{ rev: "base" }`) and `fileAtBase()` are the only sanctioned paths.
- **DON'T** return `null` or any other silent-failure sentinel from `ctx.ast()`, including `ast({ rev: "base" })`'s no-base and added-file cases — those MUST throw, distinguishably; only `fileAtBase()` reports them as `null`.
- **DON'T** invoke the Python/Ruby interpreter on a file before the language-plausibility check, or re-probe availability per file — cache it per `check` run.
- **DON'T** add `tree-sitter`, `web-tree-sitter`, or any other new production dependency — Python/Ruby support MUST use only the interpreter's own standard-library AST facility.
- **DON'T** normalize Python/Ruby output into an ESTree-like shape — explicitly out of scope.
- **DON'T** trust `node.loc` for `language: "typescript"` — that branch parses `Bun.Transpiler` output, which drops type-only statements, comments, and blank lines, so `loc` is transpiled-relative. Re-locate in the original source (`ctx.readFile()` + `indexOf`) before reporting a line, as [ARCH-008](./ARCH-008-typed-command-options.md)'s own rules do; `loc` is source-accurate only for `"javascript"`, parsed directly.
- **DON'T** drop the `-I` flag from the Python invocation when refactoring the guarded-invocation step — `python-subprocess-isolated` blocks this, and `tests/engine/runner-ast.test.ts` asserts a planted shadow `ast.py` cannot run.
- **DON'T** expect a `comments` array without `{ comments: true }` (opt-in), expect Ruby comment `loc` columns to line up with the sexp tree's node positions (comment columns are character offsets, Ripper's node positions byte offsets), or treat the TS/JS comment scan as regex-literal aware (a delimiter inside a regex literal is a known blind spot).

## Consequences

### Positive

- **Structural checks become possible for TypeScript/JavaScript without new dependencies** — the TS/JS branch reuses `meriyah`, already in the tree, closing the gap that forces `ARCH-004` and `ARCH-008` into regex heuristics.
- **Python/Ruby structural checks become possible with zero new production dependencies** — each language's own standard-library AST facility means no native binding, no WASM asset, and no ARCH-006 dependency review to ship this.
- **Consistent, auditable sandbox boundary** — extending rather than bypassing the existing `rule-scanner.ts`/`RuleContext` model means the security posture of `.rules.ts` execution changes only in the capabilities exposed through the same narrow door, not in kind.
- **Documentation-only / no-op change detection becomes possible without a subprocess** — a rule can compare `ast(path, language, { rev: "base" })` against `ast(path, language)`; comments and formatting drop out of both the ESTree and Python `ast` shapes, so a comment-only edit yields structurally identical trees. This closes [ARCH-024](./ARCH-024-rule-file-sandbox-boundary.md)'s "strands legitimate rules" gap — the pattern that required shelling out to git and an interpreter now runs inside the sanctioned door.
- **Comment-governance rules become structural** — length, style, and content policies can be written against structured comment tokens (`type`/`value`/`loc`) with original-source-accurate positions instead of fragile line/regex heuristics.
- **Failure visibility reuses proven machinery** — no new exit code, reporter branch, or error-boundary design; throw-on-failure rides on `runner.ts`'s per-rule isolation and `reporter.ts`'s exit-code-2 category.
- **Incremental adoption** — TS/JS support needs no new capability surface beyond what exists internally, and Python/Ruby can follow independently since the guardrail and failure-semantics design is identical for both.

### Negative

- **No cross-language AST vocabulary** — a rule author covering both Python and Ruby must learn two unrelated grammars (the standard `ast` module's schema and `Ripper`'s s-expression shape), unlike a tree-sitter approach's single vocabulary.
- **Environmental dependency for Python/Ruby rules** — those branches require a Python or Ruby interpreter on the machine running `archgate check`, which the project neither controls nor bundles. A rule targeting Python correctly fails (via the throw contract) where no interpreter exists — a real limitation, not a theoretical one.
- **`meriyah` gains a runtime execution path it did not previously have** — it now also runs at rule-execution time inside the compiled binary shipped to end users, not only in the `check` engine's rule-scanning step. No new ARCH-006 review is required (no new package), but its practical scope shifts from "internal scanning tool" to "runtime capability," which maintainers should weigh when evaluating future `meriyah` upgrades.
- **Language-specific grammar drift is inherited, not controlled** — standard-library AST facilities restructure across language versions (e.g. Python's `ast` module deprecating `ast.Str`/`ast.Num` for `ast.Constant` in 3.8). `ctx.ast()`'s contract does not change, but a rule's language-specific pattern matching can still break; this ADR does not insulate rule authors from upstream grammar changes.
- **`{ comments: true }` adds one field to the returned tree shape** — a root-level `comments` array is a mild departure from "exactly the language-native shape," especially for Python/Ruby whose grammars have no such slot. It is opt-in, confined to the root, and alters no language-native node, so it is not the cross-language shape unification this ADR rejects — but it is a real, if small, deviation accepted for the ergonomics of carrying comments alongside their tree.

### Risks

- **A future contributor bypasses the guardrail ordering and spawns the Python/Ruby interpreter from inside a `ctx.ast()` code path without the path-safety or language-plausibility checks.**
  - **Mitigation:** the four-step ordering in the Decision section is mandatory and reviewable; `rule-scanner.ts`'s `BLOCKED_BUN_PROPS` sandbox keeps `.rules.ts` files themselves from reaching `Bun.spawn`, so the only code path able to spawn for this feature is `createRuleContext()`, which code review MUST verify follows the ordering exactly.
- **Interpreter-version skew between the machine authoring a Python/Ruby rule and machines running `archgate check` produces inconsistent AST shapes for the same source file.**
  - **Mitigation:** inherent to shelling out to system-installed interpreters instead of bundling a pinned parser, and accepted as part of choosing this over tree-sitter. Rule authors targeting Python/Ruby should keep patterns tolerant of minor version-specific node differences, and the availability probe surfaces the interpreter's version for diagnosis.
- **The duplicated inline `parseModule()` calls in `rule-scanner.ts` are not factored out before `ctx.ast()`'s TS/JS branch lands, leaving three near-identical parse call sites instead of two.**
  - **Mitigation:** the Decision section mandates factoring this into one shared helper as part of implementing this ADR, not as optional cleanup.
- **A future contributor adds a base-revision variant, or comment support for a new language, that reads the git blob or spawns a parser/tokenizer OUTSIDE `git-files.ts` / the `ast()` guardrails** — the exact class of escape [ARCH-024](./ARCH-024-rule-file-sandbox-boundary.md) exists to prevent.
  - **Mitigation:** both surfaces ride entirely inside existing checks — comment support folds into `ast()` and its Python path reuses `runAstSubprocess` in the sanctioned `ast-support.ts` site. `no-unsanctioned-engine-subprocess` fails on any `Bun.spawn`/`child_process` in `src/engine/` outside the sanctioned `ast-support.ts`/`git-files.ts` sites, and `ast-guardrail-ordering` fails on a reordered or omitted guardrail in `ast()`. Neither extension creates a new enforcement surface.

## Compliance and Enforcement

### Automated Enforcement

Five companion checks in `ARCH-022-ast-aware-rule-context.rules.ts`:

- **`ast-guardrail-ordering`** — parses `src/engine/runner.ts` via `ctx.ast()` itself (dogfooding this capability) and verifies the `ast()` method inside `createRuleContext()` invokes the four guardrail markers — `safePath`, `AST_LANGUAGE_EXTENSIONS`, `probeInterpreter`, `runAstSubprocess` — each present and in exactly that order.
- **`no-unsanctioned-engine-subprocess`** — flags any `Bun.spawn`/`Bun.spawnSync` in `src/engine/` outside the sanctioned helpers (`ast-support.ts` for `ctx.ast()`, `git-files.ts` for git) and bans `child_process` imports in the engine entirely, mirroring how `ARCH-007/no-bun-shell` scans for banned subprocess patterns.
- **`single-ast-method`** — verifies `RuleContext` (in `src/formats/rules.ts` and the generated shim in `src/helpers/rules-shim.ts`) declares exactly one `ast(path, language)` signature and no per-language variants (`pythonAst()`, `rubyAst()`, etc.).
- **`python-subprocess-isolated`** — asserts the Python branch of the guarded invocation in `src/engine/runner.ts` includes the `-I` isolation flag, so a refactor cannot silently reintroduce the cwd stdlib-shadowing code-execution vector.
- **`rulecontext-shim-parity`** — extracts `interface RuleContext` member names from `src/formats/rules.ts` and from the generated shim template in `src/helpers/rules-shim.ts` (regex over raw text: `Bun.Transpiler` erases type-only declarations, so `ctx.ast()` cannot see them), and fails on any member present in one surface but missing from the other, in both directions. Member-name parity only — full signature and JSDoc parity remains a manual review item.

The base-revision and comment surfaces are covered by those four rules unchanged — neither adds a subprocess site or a guardrail — plus behavioural coverage in `tests/engine/runner-ast-base.test.ts` (base parsing per language, comment-only structural equivalence, throw-vs-null semantics of `ast({ rev: "base" })` versus `fileAtBase()`) and `tests/engine/runner-ast-comments.test.ts` (TS line/block extraction with delimiter-stripped values and original-source `loc`, string-literal awareness, JavaScript, the opt-in-only absence of `comments`, Ruby `Ripper.lex` line/block tokens, and Python `tokenize` extraction including the `#`-inside-a-string exclusion and composition with `{ rev: "base" }`). Ruby's character-offset columns (versus Ripper's byte offsets) and LF-normalized block values are pinned at the serializer level in `tests/engine/ast-support.test.ts`.

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

**Documented briefing-budget overflow** (reported by rchgate check)**:** the `Decision` and `Do's and Don'ts` sections exceed the `review-context` briefing cap and MUST NOT be shortened further. They carry a security boundary that degrades if partially stated: the four ordered guardrails and their marker names, the `-I` isolation invariant, the `assertNoSymlinkInPath` exemptions, the temp-file hardening modes, and the per-language comment serializer contracts. The `Decision` is front-loaded so a truncated briefing still delivers the guardrail sequence; consumers MUST open the full ADR for the rest.

## References

- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — No new production dependency; Python/Ruby support relies on system-installed interpreters rather than an approved-list addition
- [ARCH-007 — Cross-Platform Subprocess Execution](./ARCH-007-cross-platform-subprocess-execution.md) — Governs the `Bun.spawn` array-argument pattern used for the Python/Ruby branches
- [ARCH-024 — Rule File Sandbox Boundary](./ARCH-024-rule-file-sandbox-boundary.md) — The sandbox this capability complements: ARCH-024 removed the subprocess escape hatch, and the base-revision surface here restores that capability through the sanctioned `ctx.ast()` door
- [ARCH-004 — No Barrel Files or Re-Exports](./ARCH-004-no-barrel-files.md) — `isBarrelFile()`'s line heuristic is a concrete example of the regex-over-text limitation this ADR addresses
- [ARCH-008 — Typed Command Options](./ARCH-008-typed-command-options.md) — The `.option()` call-shape regex checks are a second example of the same limitation
- `src/engine/rule-scanner.ts` — The existing `meriyah`-based AST sandbox this decision extends; that mechanism is not itself documented by a formal ADR, a gap outside this ADR's scope
- [Python `ast` module documentation](https://docs.python.org/3/library/ast.html)
- [Ruby `Ripper` documentation](https://docs.ruby-lang.org/en/master/Ripper.html)
- [meriyah (npm)](https://www.npmjs.com/package/meriyah)
