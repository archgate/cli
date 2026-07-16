---
id: ARCH-024
title: Rule File Sandbox Boundary
domain: architecture
rules: false
files:
  - "src/engine/rule-scanner.ts"
  - "src/engine/loader.ts"
  - "src/helpers/adr-import.ts"
---

## Context

`src/engine/loader.ts` imports every companion `.rules.ts` file with `await import(pathToFileURL(rulesFile).href)` and executes its `check()` functions in-process. There is no interpreter boundary, no worker, and no OS-level isolation: a rule file runs with the full privileges of whoever ran `archgate check` — a developer's workstation, or a CI runner holding deploy credentials. `scanRuleSource()` in `src/engine/rule-scanner.ts` is the only control standing between that code and the machine.

This is not a theoretical exposure. Rule files arrive from outside the project by design: `archgate adr import` resolves a pack from a registry or a git source and copies its `.rules.ts` files into `.archgate/adrs/` (`writeImportedAdrs()` in `src/helpers/adr-import.ts`). The next `archgate check` imports and runs them. A pack author is therefore in a position to execute arbitrary code on every machine that imports their pack, and the scanner is what makes that acceptable.

[ARCH-022](./ARCH-022-ast-aware-rule-context.md) already leans on this boundary as a load-bearing premise. Its Decision states that a rule author "MUST NEVER be able to reach `Bun.spawn`, `child_process`, or any other subprocess/filesystem primitive directly," and its Risks section mitigates a guardrail-bypass risk by asserting that the scanner "continues to prevent `.rules.ts` files themselves from reaching `Bun.spawn`, so the only code path capable of spawning a subprocess for this feature is `createRuleContext()` itself." That mitigation is only as good as the scanner. ARCH-022's own References section flags the gap this ADR closes: the scanner "is not currently documented by a formal ADR, which is a documentation gap outside this ADR's scope."

**The gap had already cost us.** The scanner's `ImportExpression` case rejected only _non-literal_ specifiers, on the reasoning that a variable specifier cannot be checked statically. A _literal_ specifier was never tested against the module ban that `ImportDeclaration` enforced. The consequence was a one-token bypass of the entire sandbox:

```typescript
import { spawn } from "node:child_process"; // blocked
const cp = await import("node:child_process"); // executed
```

A fire test confirmed the full impact end-to-end: a `.rules.ts` file ran `git config user.email`, exfiltrated the result into a file it wrote to disk, and `archgate check` reported `"pass": true` with zero violations. The sandbox failed silently, and the governance tool reported success while doing so.

Probing the same boundary found the literal-`import()` hole was one spelling among many. Every one of these executed:

| Spelling                                      | Why the denylist missed it                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `await import("./evil.ts")`                   | Relative path; names no builtin. The scanner never reads the target file.    |
| `await import("data:text/javascript,...")`    | A URL, not a module name.                                                    |
| `import x from "some-npm-pkg"`                | Bare package; names no builtin.                                              |
| `import { createRequire } from "node:module"` | `node:module` was not on the ban list.                                       |
| `require("node:child_process")`               | `require` was blocked only for _imported_ rules, never for first-party ones. |
| `import.meta.require("node:child_process")`   | Neither an `ImportExpression` nor a banned identifier.                       |
| `process.binding("spawn_sync")`               | Reaches spawn while importing nothing at all.                                |
| `export * from "node:child_process"`          | A re-export evaluates the module exactly as an import does.                  |

**Alternatives considered:**

- **Keep the denylist and add the missing cases** — Rejected. This is what the table above disproves. The denylist enumerated _dangerous builtins_, but the capability being contained is "evaluate code," and a specifier does not have to name a builtin to do that. Each escape found was a distinct category, not a missing entry, and `data:` URLs alone are unbounded. A denylist here is a permanent commitment to losing a race against the module resolver.
- **Scan transitively — follow relative imports and scan those files too** — Rejected as the general mechanism. It contains only the relative-path case while leaving `data:` URLs and bare packages untouched, and it would require the scanner to resolve and re-scan an arbitrary graph (including `node_modules`) on every check. Refusing what cannot be vouched for is both stronger and cheaper.
- **Run rule files in a real sandbox (worker, subprocess, or VM with a restricted module resolver)** — Deferred, not rejected. This would enforce the boundary at execution time rather than by static analysis, which is strictly more robust and would survive scanner bugs like this one. It is a substantially larger design change — `RuleContext` would need to cross a serialization boundary, and per-rule startup cost would land on every check — and it warrants its own ADR. Until then, the static scan is the boundary, and this ADR governs it.
- **Do nothing; treat `.rules.ts` as trusted project code** — Rejected. It is defensible for rules a team writes itself, but `archgate adr import` exists specifically to pull rule code from third parties. Removing the sandbox would make importing a pack equivalent to `curl | sh`, and would invalidate ARCH-022's stated mitigation.

For Archgate specifically, the tool's entire value proposition is that running `archgate check` on a repository is safe. The check is what CI runs on every pull request, including pull requests from forks. A rule-file escape is not a bug in a linter; it is remote code execution reachable by anyone who can open a PR that adds a file.

## Decision

`.rules.ts` source MUST be statically scanned by `scanRuleSource()` and pass with zero violations before `src/engine/loader.ts` imports it. The following constraints govern that scan.

**1. The module check MUST be an allowlist, never a denylist.**

`ALLOWED_MODULES` in `src/engine/rule-scanner.ts` enumerates the module specifiers a rule file may import. Any specifier not in that set MUST be blocked. A denylist of dangerous modules MUST NOT be reintroduced in any form.

The rationale is a direct consequence of the threat model: rule files execute in-process, so _any_ module a rule file can reach is arbitrary code execution. The unsafe set is therefore "every specifier that resolves to code" — unbounded, and not enumerable in principle. The safe set is four modules. Enumerate the set that is finite.

**2. Only `node:`-prefixed specifiers MAY be allowlisted.**

The permitted set is `node:path`, `node:url`, `node:util`, `node:crypto`. The bare forms MUST NOT be allowed: `import { basename } from "path"` resolves to `node_modules/path` if the _target project_ ships a package by that name, which hands execution straight back to the untrusted code the scanner exists to contain. The `node:` scheme always resolves to the built-in and cannot be shadowed.

**3. Every construct that causes a module to be evaluated MUST pass through the same check.**

That is: static `import`, dynamic `import()` with a literal specifier, dynamic `import()` with a non-literal specifier (refused outright, since it cannot be checked statically), `export ... from`, and `export * from`. A re-export evaluates its target exactly as an import does.

This clause exists because a gap in any one construct is a gap in all of them. The incident above was precisely that shape: `ImportDeclaration` enforced the ban correctly and `ImportExpression` did not, and the weaker of the two set the boundary's real strength.

**4. Naming a dangerous runtime global MUST be blocked — not the shapes of using it.**

A rule file runs in-process, so `Bun`, `process`, and the global object are live and expose subprocess, filesystem, and native capabilities with **no import at all**. The module allowlist (clause 1) does nothing here: `Bun.spawn(...)` needs no `import`. Blocking specific _shapes_ of reaching these globals — `Bun.spawn` dotted, `Bun[x]` computed — is the identical losing game clause 1 rejects for modules, because the ways to name the same capability are unbounded. All of the following reach `Bun.spawn` without matching any per-shape check, and were live RCEs before this clause (each ran arbitrary code while `archgate check` reported a pass): aliasing (`const B = Bun; B.spawn(...)`), destructuring (`const { spawn } = Bun`), reflection (`Reflect.get(Bun, "spawn")`), and global-object aliases (`globalThis.Bun.spawn`, `global.Bun.spawn`, `self.Bun.spawn` — Bun binds the global object under all three names).

The scanner therefore refuses any **code reference to a dangerous global identifier**, in any position other than a property-key slot (`foo.process` and `{ process: 1 }` name a property, not the global, and are fine): `Bun`, `process`, `globalThis`, `global`, `self`, `Reflect`, `eval`, `Function`, `fetch`, `WebSocket`, `XMLHttpRequest`, `EventSource`, and `require` MUST be blocked. Blocking the _identifier_ (not the call) is what closes the aliases: `const f = Function` and `const r = require` are refused the same as `Function(...)`/`require(...)`. `import.meta.require(...)` is handled separately, since it is a `MetaProperty` member rather than a bare identifier.

Because naming `Function`/`eval` is now blocked, the scanner MUST ALSO refuse `.constructor` access — dotted (`x.constructor`) and computed-literal (`x["constructor"]`) — on **any** receiver. `(() => {}).constructor` **is** the `Function` constructor, i.e. `eval`: `f = (() => {}).constructor; f("return import('node:child_process')")()` runs arbitrary, unscanned code and bypasses even the module allowlist. This was the second fire-tested RCE. `.constructor` is also reachable through a **destructuring binding pattern** — `const { constructor: F } = (() => {})` reads the same property through an `ObjectPattern` the member-expression check never visits — so the block MUST cover the destructured forms too: the renamed key (`{ constructor: F }`), the computed-string key (`{ ["constructor"]: F }`), and the shorthand (`{ constructor }`). An object _literal_ `{ constructor: 1 }` merely names a property and is fine; only the binding-pattern form performs the read.

This clause **subsumed and simplified** the prior per-shape checks: the `BLOCKED_BUN_PROPS`/process-internals member denylists and the separate `eval`/`Function`/`fetch`/`require` call checks were removed, replaced by the single identifier block. First-party and imported scans have **converged** as a result — the previously imported-only restrictions (`Bun`/`process` environment reads, `require`, `WebSocket`) are now blocked for every rule file, so `scanImportedRuleSource()` delegates to `scanRuleSource()`. This is deliberate: a first-party rule file also executes with full privilege, and a malicious pull request can add one, so the aliasing bypass had to close for _all_ rules, not only imported ones. An audit confirmed zero of this repository's own `.rules.ts` files reference any of these globals as executable code — every mention is a string the rule searches _for_ — so the block has no false positives on real rules.

**Known residual (a static-analysis limit, not an oversight).** A property name built at runtime — `const c = "constructor"; (() => {})[c]`, or its destructured twin `const { [c]: F } = (() => {})` — is unknowable to a scanner that does not track values, and blocking _all_ computed member access (or computed destructuring) would reject ordinary `arr[i]`/`obj[key]`/`const { [k]: v } = obj`. So the computed-_variable_-key route to `.constructor`, and thus to `eval`, remains open in both the member and destructuring spellings. This is the same class as the computed non-literal `import()` clause 3 already refuses only when it cannot resolve the specifier, and it is exactly why this ADR names execution-time isolation as the complete answer: the static scan is defense-in-depth that raises the bar from a trivial one-liner to requiring runtime string construction, not a jail. A regression test asserts this residual explicitly, so it is a deliberate, documented gap rather than an accidental one.

Property matching MUST additionally read the key from **both** spellings, `o.name` and `o["name"]` (`staticPropName()` in `src/engine/rule-scanner.ts`). A member expression has two syntaxes for one capability, and reading only `prop.name` sees one of them: `process["binding"]("spawn_sync")` was reachable for exactly this reason after the first pass at fixing this ADR's incident. Matching the property name in either spelling closes the aliased receiver too, since `const p = process; p["binding"](...)` is caught by the key, not the object.

The accepted limit is a computed key that is not a literal — `p[k]`, where `k` is a variable. Resolving it requires tracking values, which this scanner does not do and MUST NOT pretend to: blocking all computed access instead would reject `o[key]` in ordinary rule code. This is the static-analysis ceiling recorded under Consequences below, and the reason execution-time isolation remains the sanctioned direction for strengthening this boundary rather than more elaborate pattern matching.

**5. Third-party rule files MUST be scanned at import time, before reaching disk.**

`writeImportedAdrs()` in `src/helpers/adr-import.ts` MUST run `scanImportedRuleSource()` on every incoming `.rules.ts` and refuse the entire import if any file has violations. The scan MUST happen before the first file is written, so a rejected pack requires no rollback.

Import time is the only point where this is possible: once a file lands in `.archgate/adrs/` it is byte-for-byte indistinguishable from a rule the project wrote itself, and the engine has no provenance to key the stricter checks off. This clause is recorded partly as history — `scanImportedRuleSource()` existed and was unit-tested from the outset, but had **zero production call sites**, so its stricter checks (`Bun.env` reads, `process.env` reads, `WebSocket`) never ran against a single imported rule. A tested security control is not an enforced one.

**6. Raw source text MUST be scanned for invisible characters, and MUST NOT be scanned for dangerous names.**

`.rules.ts` source MUST pass a raw-text scan (`scanSourceText()`) before transpilation, rejecting bidi controls, directional marks, and zero-width or invisible characters — the "Trojan Source" class (CVE-2021-42574). A BOM at offset 0 is permitted as an encoding artifact. These violations carry true source positions, need no remapping through the transpiler, and MUST be reported even when the file fails to parse, since a file that does not parse is where a hidden character is most worth surfacing.

This pass exists for one reason: it catches the only class of problem the AST **cannot**. The parser resolves the true program, so a bidi override is invisible to it _by design_. The target is not the parser but the human reading the diff — a maintainer approving an imported rule pack — and against that reader the AST offers nothing. Before this clause, a `RIGHT-TO-LEFT OVERRIDE` and a homoglyph identifier both scanned clean.

**The same pass MUST NOT be extended into a text search for dangerous identifiers or module names.** The intuition that raw text adds a safety net against obfuscation is backwards, on two independent grounds:

- **It is weaker than the AST at precisely the thing it appears to add.** The raw text of `await import("\x6eode:child_process")` does not contain the string `node:child_process` at all — a regex hunting for that string sails past. The AST blocks it, because the parser resolves the escape before the allowlist sees the specifier. Transpiling and parsing _de-obfuscates_; reading raw text _re-obfuscates_. The same holds for unicode escapes, escaped identifiers, and concatenated or templated specifiers (the latter two are non-literal, and refused outright by clause 3).
- **It cannot tell a rule's code from a rule's data.** Rule files legitimately contain dangerous-looking strings as the patterns they search _for_ in a target project. Three of this repository's own rule files would be blocked by such a search: `ARCH-007-cross-platform-subprocess-execution.rules.ts`, `ARCH-014-prefer-bun-env.rules.ts`, and `ARCH-022-ast-aware-rule-context.rules.ts` all name `child_process`, `Bun.spawn`, or `process.env` as literals. A check that fails on Archgate's own governance rules is not a check.

A denylist is legitimate _here_ and nowhere else in this ADR. Clause 1 rejects a denylist of modules because the unsafe set is bounded only by imagination; the bidi and invisible code points are enumerated by the Unicode specification, so the set is closed by someone other than us. That distinction — not convenience — is what makes the two clauses consistent.

**Scope.** This ADR governs the static scan that gates `.rules.ts` execution, and where that gate is applied. It does not cover the `RuleContext` API surface itself (see [ARCH-022](./ARCH-022-ast-aware-rule-context.md)), the sandboxing of `ctx.readFile`/`ctx.glob` paths, or any future move to execution-time isolation, which would require its own ADR.

## Do's and Don'ts

### Do

- **DO** keep the module check as an allowlist — add to `ALLOWED_MODULES` deliberately, and only after establishing the module cannot be shadowed by the target project and cannot itself load further code
- **DO** route every module-evaluating construct through the same allowlist check (`ImportDeclaration`, `ImportExpression`, `ExportNamedDeclaration`, `ExportAllDeclaration`)
- **DO** refuse a dynamic `import()` whose specifier is not a literal — an unresolvable specifier cannot be checked, and unchecked means executed
- **DO** match process-internal property names (`binding`, `dlopen`, `_linkedBinding`) on the property alone, so an aliased receiver cannot spell around the check
- **DO** scan imported rule files in `writeImportedAdrs()` before any file is written to disk
- **DO** add a failing regression case to `tests/engine/rule-scanner-escapes.test.ts` **before** fixing any newly discovered escape, so the test demonstrably catches it
- **DO** verify a scanner change against a real payload, not only unit assertions — an escape is only closed when a `.rules.ts` that actually attempts it is refused by `archgate check`
- **DO** direct rule authors who need language tooling to `ctx.ast()` per [ARCH-022](./ARCH-022-ast-aware-rule-context.md), which is the sanctioned door to a subprocess
- **DO** block _naming_ a dangerous runtime global (`Bun`, `process`, `globalThis`/`global`/`self`, `Reflect`, `eval`, `Function`, `fetch`, `WebSocket`, `require`, …) rather than the shapes of using it — aliasing, destructuring, and reflection all reach the same capability, so the identifier is the only durable anchor
- **DO** block `.constructor` access on any receiver in every spelling that statically reads it — dotted (`x.constructor`), computed-literal (`x["constructor"]`), and destructuring binding patterns (`const { constructor: F } = x`, including the computed-string and shorthand keys) — it is the property-chain route to the `Function` constructor, which is `eval`
- **DO** keep the first-party and imported scans converged (`scanImportedRuleSource()` delegates to `scanRuleSource()`) unless a genuinely imported-only restriction is ever needed — a first-party rule executes with full privilege too
- **DO** keep the raw-text pass scoped to character-level integrity, and reach for the AST for anything semantic — the parser is the stronger tool everywhere it applies
- **DO** spell blocked code points numerically (`0x202e`), never as literal characters and never as `\u` escapes. A literal would hide inside the scanner's own source where no reviewer could see it, and an escape is not durable: a formatter may normalise it back into the literal character. This is not hypothetical — it happened twice while implementing this ADR, once in a source comment and once in a test fixture, where a `n` silently became a plain `n` and turned an obfuscation test into an ordinary one

### Don't

- **DON'T** reintroduce a denylist of dangerous modules in any form — the unsafe set is not enumerable, and the previous denylist was bypassed by eight distinct spellings
- **DON'T** allowlist a bare specifier (`path`, `url`) — bare names are shadowable by the target project's `node_modules`; use the `node:` form
- **DON'T** allowlist `node:module` — `createRequire()` reconstitutes the whole capability the allowlist removes
- **DON'T** add a module-evaluating AST node type to the walker without wiring it to the allowlist — an unchecked construct silently becomes the boundary's weakest point
- **DON'T** assume a specifier is safe because it names no Node builtin — `./evil.ts`, `data:text/javascript,...`, and bare npm packages all execute code
- **DON'T** import a rule file that has not been scanned, or scan it after `import()` — the module body executes at import, before any `check()` is called
- **DON'T** rely on `scanImportedRuleSource()` alone for imported rules — it is additive to `scanRuleSource()`, not a replacement
- **DON'T** treat a passing `archgate check` as evidence the sandbox holds — it reported `"pass": true` throughout the incident described above
- **DON'T** add a text search for `child_process`, `Bun.spawn`, or any other dangerous name. It is weaker than the AST, which resolves the escapes that defeat a regex, and it false-positives on this repository's own rule files, which name those strings as the patterns they search for
- **DON'T** write an obfuscation test fixture as inline escape text without a guard asserting it is still obfuscated — a normalised escape turns the test into a no-op that passes for the wrong reason
- **DON'T** reintroduce a per-shape denylist of `Bun`/`process` members (`Bun.spawn`, `process.binding`) — an alias, destructure, or reflection walks straight around it, exactly as the module denylist was walked around; block the identifier instead
- **DON'T** try to close the computed-variable-key route to `.constructor` by blocking all computed member access — it would reject ordinary `obj[key]`; that residual belongs to execution-time isolation, not to more pattern-matching

## Consequences

### Positive

- **The boundary matches the threat model.** The allowlist refuses anything it cannot vouch for, so an unanticipated way of naming code fails closed instead of executing. The eight escapes found during the incident collapse into one rule.
- **Failure modes are visible.** A blocked rule file surfaces as a `security-scan` error naming the specifier and line, rather than executing silently and reporting a pass.
- **ARCH-022's mitigation becomes true.** ARCH-022 mitigates its guardrail-bypass risk by asserting `createRuleContext()` is the only code path that can spawn a subprocess. That assertion held only if the scanner did; now it does.
- **Third-party rule code is gated where provenance still exists.** Scanning in `writeImportedAdrs()` catches untrusted rules at the one moment the system knows they are untrusted, and refuses before writing anything.
- **The safe set is small enough to review.** Four `node:`-prefixed modules can be reasoned about exhaustively, which is not true of a ban list that must anticipate every future resolver behaviour.
- **The reflective/aliasing class is closed with one rule, and the scanner got simpler.** Blocking the global identifier collapses aliasing, destructuring, reflection, and global-object aliases into a single check; the scattered per-shape `Bun`/`process`/`eval`/`fetch` member and call checks were deleted, and the first-party and imported scans converged.

### Negative

- **Breaking change for existing rule files.** Any `.rules.ts` importing outside the four allowed modules now fails, including rules doing legitimate work by illegitimate means. The migration is real: a rule shelling out to a language parser must move to `ctx.ast()` ([ARCH-022](./ARCH-022-ast-aware-rule-context.md)), which is a rewrite, not a find-and-replace.
- **Legitimate helper reuse across rule files is refused.** A relative import of a shared helper is blocked along with `./evil.ts`, because the scanner cannot distinguish them — it never reads either. Rule files must be self-contained.
- **The allowlist is a maintenance surface.** Every genuine future need for a safe module requires an explicit review and an edit here, rather than "it wasn't banned, so it worked."
- **Static analysis remains the boundary.** This ADR hardens the scan but does not change its nature: the scanner still reasons about source text, and a bug in it is still an escape. Execution-time isolation would not have this property. The clause-4 residual (a `.constructor` reached via a runtime-computed key) is the concrete face of this — closable only by isolation, not by more pattern-matching.
- **Rules can no longer name these globals at all, even for benign reads.** `Bun.env`, `process.platform`, and `Bun.Glob` are refused along with `Bun.spawn`, a real capability reduction for first-party rules. It is accepted because rules interact with the project only through `ctx` and the audit found no rule that needed a global; a rule that genuinely wants such data is a `ctx` feature request, not a reason to reopen the alias. There is also a small false-positive surface: a rule using one of these names as a local variable or parameter (`self`, `global`) is refused and must rename.

### Risks

- **A new AST construct that evaluates a module is added to the walker without being wired to the allowlist**, silently recreating the exact gap this ADR documents.
  - **Mitigation:** the Decision requires every module-evaluating construct to share one code path (`checkModuleSpecifier()`), so new node types are added to an existing `case` list rather than to a parallel check. `tests/engine/rule-scanner-escapes.test.ts` covers each construct explicitly, and reviewers are directed (below) to treat any new module-naming construct as in scope.
- **The scanner's single-file view is mistaken for a whole-program guarantee**, and a future contributor "fixes" the refusal of relative imports by following them instead.
  - **Mitigation:** the scanner is single-file by construction — refusing what it cannot read is the design, not an omission. This is stated in the Decision and in the Don'ts, and the alternatives analysis in Context records why transitive scanning was rejected.
- **`ALLOWED_MODULES` is widened under delivery pressure to unblock a rule**, admitting a module that can load further code.
  - **Mitigation:** the Don'ts name `node:module` as the concrete cautionary case, and Manual Enforcement below requires reviewers to establish non-shadowability and non-loading before any addition. Any widening is a reviewable one-line diff in a file this ADR scopes.
- **An obfuscation regression test silently degrades into testing the plain case**, because tooling normalised the escape sequence in its fixture. The suite stays green while covering nothing — the same failure as the risk below, arriving through the toolchain rather than through an author's intent.
  - **Mitigation:** fixtures in `tests/engine/rule-scanner-escapes.test.ts` are built from a concatenated backslash constant (`const BS = "\\"`), which no formatter can collapse, and the suite carries an explicit guard test asserting each fixture does **not** contain the plain text it is meant to hide. That guard is not decorative: it caught exactly this during implementation, after an inline `n` had already been normalised to `n`.
- **A scanner regression ships because the test suite encodes the bug as intended behaviour.** This is not hypothetical: the suite contained `test("allows import with literal string")` with the comment "allowed by dynamic import check," which asserted the vulnerability was correct. It passed for the vulnerability's entire lifetime.
  - **Mitigation:** escape regression tests are consolidated in `tests/engine/rule-scanner-escapes.test.ts`, where each case is framed as an attack that must be blocked rather than a behaviour that is permitted. Reviewers are directed to read a permissive assertion in that file as a claim requiring justification.
- **A future Bun/Node release exposes the global object or a capability under a new alias, or a new `eval` path appears**, reopening the reflective/global class.
  - **Mitigation:** the block is on the identifier set, so a new alias is a one-line addition — with a matching case in the "reflective and aliased access to runtime globals" block of `tests/engine/rule-scanner-escapes.test.ts`, which encodes every known route (aliasing, destructuring, reflection, the three global-object aliases, and the `Function`-constructor chain reached by both member access and destructuring) plus the documented computed-variable residual. The first-party/imported convergence keeps that coverage identical for both entry points, so a new alias cannot be closed for one and left open for the other.

## Compliance and Enforcement

### Automated Enforcement

**This ADR carries `rules: false` deliberately.** That is a design decision, not an omission, and it should not be "fixed" by adding a companion `.rules.ts`.

The invariant here is behavioural — _a rule file cannot reach `child_process`_ — and a companion rule can only assert the implementation's shape: that a constant named `ALLOWED_MODULES` exists, that `loader.ts` calls `scanRuleSource()` before `import()`. Such rules are brittle in the benign direction (renaming a constant fails the check while the boundary is intact) and, decisively, useless in the dangerous one. **A rule asserting "the loader scans before importing" would have passed for the entire lifetime of the incident described above.** The loader did scan, in the right order, before every import. The scan simply did not work. A structural check cannot see the difference between a boundary and the appearance of one.

Enforcement therefore lives where behaviour can actually be observed:

- **`tests/engine/rule-scanner-escapes.test.ts`** — the authoritative enforcement artifact. Every known escape is encoded as a case asserting the scanner blocks it, alongside cases asserting legitimate rule files still pass. A regression fails the suite. Coverage spans the clauses that can be exercised: module specifiers in every construct; the reflective/global class of clause 4 — a "reflective and aliased access to runtime globals" block covering aliasing, destructuring, `Reflect.get`, the three global-object aliases, and the `Function`-constructor chain in both its member-access and destructuring (`{ constructor: F }`) spellings, plus the explicit computed-variable-key residual tests for both and "legitimate global-adjacent code still passes" cases (`Object.keys`, a property merely named `process`, a normal `ctx`-only rule); the raw-text pass (bidi and invisible characters, leading-BOM tolerance, reporting through a parse failure); and the obfuscated-specifier cases that demonstrate the AST resolving what a text search would miss — guarded by a test asserting those fixtures are genuinely obfuscated. The message and position assertions for the converged identifier model live in `tests/engine/rule-scanner.test.ts` and `tests/engine/rule-scanner-positions.test.ts`.
- **`tests/helpers/adr-import.test.ts`** — asserts `writeImportedAdrs()` refuses a rule file reaching `child_process` and writes nothing, including no ADR markdown.
- **`bun run validate`** — runs both suites and blocks the pipeline on failure.

### Manual Enforcement

Code reviewers MUST verify, for any PR touching `src/engine/rule-scanner.ts`, `src/engine/loader.ts`, or `writeImportedAdrs()`:

1. The module check is still an allowlist. Any construct resembling a ban list of dangerous modules is a violation of this ADR regardless of how complete it looks.
2. Any new AST node type in the walker that can name or evaluate a module is wired to `checkModuleSpecifier()`.
3. Any addition to `ALLOWED_MODULES` is justified in the PR description against two questions: can the target project shadow this specifier, and can this module load further code? `node:module` fails the second.
4. Any newly discovered escape arrives with a **failing** test in `tests/engine/rule-scanner-escapes.test.ts` added before the fix, so the test is demonstrated to catch it.
5. A permissive assertion in the escape suite (any test named "allows...") is justified explicitly. The suite's default posture is refusal.
6. `scanRuleSource()` still runs before `import()` in `loader.ts`, and `scanImportedRuleSource()` still runs before the first `writeFileSync()` in `writeImportedAdrs()`.
7. The raw-text pass has not grown a search for dangerous names, and blocked code points are still spelled numerically rather than as literals or escapes.
8. Dangerous globals are blocked by **naming** (the banned-identifier set), not by per-shape member/call checks. A newly added blocked global or `.constructor`-style property check arrives with a matching case in the reflective-globals block of the escape suite, and covers the `o.name`/`o["name"]` member spellings and the `{ name: v }` destructuring spelling via `staticPropName()`.
9. The first-party and imported scans are still converged (`scanImportedRuleSource()` delegates), so a new global block cannot be closed for one entry point and left open for the other.

### Exceptions

Any proposal to widen `ALLOWED_MODULES` beyond `node:`-prefixed specifiers, to follow imports transitively rather than refuse them, or to remove the import-time scan in `writeImportedAdrs()` MUST be documented as a separate ADR and approved by the project maintainer before implementation. Moving `.rules.ts` execution into a real sandbox (worker, subprocess, or restricted-resolver VM) is the sanctioned direction for strengthening this boundary and likewise warrants its own ADR — it would change the nature of the guarantee, not just its coverage.

## References

- [ARCH-022 — AST-Aware Rule Context](./ARCH-022-ast-aware-rule-context.md) — Depends on this boundary: its "rule authors MUST NEVER reach `Bun.spawn`/`child_process`" invariant and its guardrail-bypass mitigation are only true if the scanner holds. Its References section flagged the documentation gap this ADR closes. `ctx.ast()` is the sanctioned alternative for rules needing language tooling.
- [ARCH-007 — Cross-Platform Subprocess Execution](./ARCH-007-cross-platform-subprocess-execution.md) — Governs subprocess execution for the engine's sanctioned spawn sites; rule files have no sanctioned spawn site at all
- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — `meriyah`, the parser backing this scan, is governed there
- [ARCH-002 — Error Handling](./ARCH-002-error-handling.md) — `writeImportedAdrs()` refuses a blocked pack by throwing `UserError`, surfaced as an expected failure by the command's error boundary
- `src/engine/rule-scanner.ts` — `scanRuleSource()`, `scanImportedRuleSource()`, `ALLOWED_MODULES`
- `src/engine/loader.ts` — the security gate and the `import()` it protects
- `src/helpers/adr-import.ts` — `writeImportedAdrs()`, the import-time gate for third-party rules
- `tests/engine/rule-scanner-escapes.test.ts` — the enforcement artifact for this ADR
- [MDN — `import()` (dynamic import)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import) — Specifier resolution, including `data:` URLs
- [Node.js — `node:` imports](https://nodejs.org/api/esm.html#node-imports) — Why the `node:` scheme cannot be shadowed by `node_modules`
- [Trojan Source: Invisible Vulnerabilities (CVE-2021-42574)](https://trojansource.codes/) — The class of attack the raw-text pass exists for, and why an AST cannot report it
- [Unicode UAX #9 — Bidirectional Algorithm](https://www.unicode.org/reports/tr9/) — The specification that closes the set of bidi control characters, which is what makes a denylist defensible in clause 6 but not in clause 1
