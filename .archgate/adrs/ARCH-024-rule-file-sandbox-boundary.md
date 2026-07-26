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

Rule files arrive from outside the project by design: `archgate adr import` resolves a pack from a registry or a git source and `writeImportedAdrs()` in `src/helpers/adr-import.ts` copies its `.rules.ts` files into `.archgate/adrs/`, where the next `archgate check` imports and runs them. A pack author is therefore in a position to execute arbitrary code on every machine that imports their pack. `archgate check` is also what CI runs on every pull request, including pull requests from forks: an escape here is not a linter bug, it is remote code execution reachable by anyone who can open a PR that adds a file.

[ARCH-022](./ARCH-022-ast-aware-rule-context.md) leans on this boundary as a load-bearing premise: its invariant that a rule author "MUST NEVER be able to reach `Bun.spawn`, `child_process`, or any other subprocess/filesystem primitive directly," and its guardrail-bypass mitigation asserting that `createRuleContext()` is the only code path able to spawn a subprocess, are true only while the scanner holds.

A denylist cannot hold it. The capability being contained is "evaluate code," and a specifier does not have to name a dangerous builtin to do that. Each of these evaluates code while naming nothing a module ban list can enumerate:

| Spelling                                      | Why a denylist misses it                                             |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `await import("./evil.ts")`                   | Relative path; names no builtin. The scanner never reads the target. |
| `await import("data:text/javascript,...")`    | A URL, not a module name.                                            |
| `import x from "some-npm-pkg"`                | Bare package; names no builtin.                                      |
| `import { createRequire } from "node:module"` | Reconstitutes `require` from a module easily left off a ban list.    |
| `require("node:child_process")`               | Not an import declaration at all.                                    |
| `import.meta.require("node:child_process")`   | Neither an `ImportExpression` nor a bare identifier.                 |
| `process.binding("spawn_sync")`               | Reaches spawn while importing nothing at all.                        |
| `export * from "node:child_process"`          | A re-export evaluates the module exactly as an import does.          |

The same argument applies to runtime globals: `Bun.spawn` is reachable by aliasing (`const B = Bun`), destructuring, `Reflect.get`, and the `globalThis`/`global`/`self` aliases, and `(() => {}).constructor` is the `Function` constructor — that is, `eval` — reachable off any receiver, including through a destructuring binding pattern.

A `node:`-prefixed specifier resists the same shadowing problem: Node's module resolution reserves the `node:` scheme, so a target project's own `node_modules/path` cannot intercept `node:path` the way it can intercept a bare `path` import — which is why the Decision's allowlist admits only the `node:` form.

**Alternatives considered:**

- **Keep the denylist and add the missing cases** — Rejected. Each escape above is a distinct category rather than a missing entry, and `data:` URLs alone are unbounded. A denylist is a permanent commitment to losing a race against the module resolver.
- **Scan transitively — follow relative imports and scan those files too** — Rejected as the general mechanism. It contains only the relative-path case, leaves `data:` URLs and bare packages untouched, and would require resolving and re-scanning an arbitrary graph (including `node_modules`) on every check. Refusing what cannot be vouched for is stronger and cheaper.
- **Run rule files in a real sandbox (worker, subprocess, or VM with a restricted module resolver)** — Deferred, not rejected. It would enforce the boundary at execution time and survive scanner bugs, but `RuleContext` would have to cross a serialization boundary and per-rule startup cost would land on every check. It warrants its own ADR; until then the static scan is the boundary.
- **Do nothing; treat `.rules.ts` as trusted project code** — Rejected. `archgate adr import` exists specifically to pull rule code from third parties, so removing the sandbox makes importing a pack equivalent to `curl | sh` and invalidates ARCH-022's stated mitigation.

## Decision

`.rules.ts` source MUST be statically scanned by `scanRuleSource()` and pass with zero violations before `loader.ts` imports it. Key Definitions carries the exact identifier lists these clauses cite.

**1. Allowlist, never a denylist.** `ALLOWED_MODULES` (`rule-scanner.ts`) enumerates every specifier a rule file may import; any other specifier MUST be blocked, and a denylist MUST NOT be reintroduced.

**2. Only `node:`-prefixed specifiers MAY be allowlisted** (Key Definitions has the four); bare forms MUST NOT be allowed (Context: why `node:` resists shadowing).

**3. Every construct that evaluates a module MUST pass the same check:** static `import`, literal-specifier dynamic `import()`, `export ... from`, `export * from`. A non-literal `import()` specifier MUST be refused outright.

**4. Dangerous runtime globals MUST be blocked by name, not usage shape** — Key Definitions has the identifier set, blocked `.constructor` spellings, and matching mechanism; Do's/Don'ts covers scan convergence.

**5. Third-party rule files MUST be scanned at import time, before reaching disk.** `writeImportedAdrs()` MUST run `scanImportedRuleSource()` on each incoming file and refuse the entire import on any violation, before the first file is written.

**6. Raw source text MUST be scanned for invisible characters, and MUST NOT be scanned for dangerous names.** `scanSourceText()` runs before transpilation (Key Definitions lists the blocked classes). Reported even when the file fails to parse.

**7. The walk MUST visit every node; `AstNodeSchema` MUST NOT reject a node over a field the scanner does not read** — Consequences has the silent-drop risk this guards against, Key Definitions the exact constraints. Restore a dropped node by _widening_ the schema, never a new block.

**Scope.** Governs the static scan gating `.rules.ts` execution, not `RuleContext` ([ARCH-022](./ARCH-022-ast-aware-rule-context.md)), `ctx.readFile`/`ctx.glob` sandboxing, or a future execution-time isolation move.

## Key Definitions

**Allowed modules (clause 2):** `node:path`, `node:url`, `node:util`, `node:crypto` — the only specifiers `ALLOWED_MODULES` admits.

**Blocked globals (clause 4):** `Bun`, `process`, `globalThis`, `global`, `self`, `Reflect`, `eval`, `Function`, `fetch`, `WebSocket`, `XMLHttpRequest`, `EventSource`, `require`, and `import.meta.require(...)`, blocked outside a property-key slot (`foo.process`, `{ process: 1 }` are fine).

**Blocked `.constructor` spellings (clause 4):** `x.constructor`, `x["constructor"]`, `{ constructor: F }`, `{ ["constructor"]: F }`, `{ constructor }` — refused on any receiver, matched via `staticPropName()`. Consequences records the one accepted residual: a `.constructor` reached through a runtime-computed key.

**Invisible-character classes blocked (clause 6):** bidi controls, directional marks, and zero-width/invisible characters — the "Trojan Source" class (CVE-2021-42574). A BOM at offset 0 is permitted.

**`AstNodeSchema` constraints (clause 7):** `.passthrough()`, constrained only to `type`, `name`, `computed`, `source`, `object`, `property`, `callee`, `left`; `source` stays nullable, and a `Literal`'s `value` stays `z.unknown().optional()`.

**Module-evaluating AST node types routed through the module check (clause 3):** `ImportDeclaration`, `ImportExpression`, `ExportNamedDeclaration`, `ExportAllDeclaration`.

**Process-internal properties blocked alongside `.constructor` (clause 4):** `binding`, `dlopen`, `_linkedBinding`.

## Do's and Don'ts

### Do

- **DO** keep the module check an allowlist (Manual Enforcement item 3)
- **DO** route every module-evaluating construct through that check (Key Definitions), refuse non-literal `import()` specifiers
- **DO** block dangerous globals by name, not usage shape (Key Definitions); keep `scanImportedRuleSource()` delegating to `scanRuleSource()`
- **DO** match dangerous properties by name, both `o.name`/`o["name"]` spellings (Key Definitions)
- **DO** scan imported rule files in `writeImportedAdrs()` before any file is written to disk
- **DO** model `AstNodeSchema` so no valid ESTree node fails validation (Key Definitions)
- **DO** add a failing case to `rule-scanner-escapes.test.ts` before fixing a new escape, confirmed by `archgate check` refusing it
- **DO** direct rule authors needing language tooling to `ctx.ast()` ([ARCH-022](./ARCH-022-ast-aware-rule-context.md))
- **DO** keep the raw-text pass scoped to character integrity; use the AST for anything semantic
- **DO** spell blocked code points numerically (`0x202e`), never as literal characters or escapes

### Don't

- **DON'T** reintroduce a denylist — of modules or `Bun`/`process` member shapes
- **DON'T** allowlist a bare specifier or `node:module` — `createRequire()` reconstitutes what the allowlist removes
- **DON'T** add a module-evaluating AST node type without wiring it to the allowlist
- **DON'T** assume a specifier is safe for naming no Node builtin (Context's escape table)
- **DON'T** import an unscanned rule file, or scan after `import()` — `scanImportedRuleSource()` is additive to, not a replacement for, `scanRuleSource()`
- **DON'T** text-search for dangerous names — misses `import("\x6eode:child_process")`-style obfuscation (Manual Enforcement item 7)
- **DON'T** read a green `archgate check` as proof the sandbox holds — a successful escape produces one too
- **DON'T** tighten `AstNodeSchema`, or block all computed access to close the `.constructor` route (Consequences: the residual, and why)

## Consequences

### Positive

- **The boundary matches the threat model.** The allowlist refuses anything it cannot vouch for, so an unanticipated way of naming code fails closed instead of executing. Every known module-escape spelling collapses into one rule.
- **Failure modes are visible.** A blocked rule file surfaces as a `security-scan` error naming the specifier and line, rather than executing silently and reporting a pass.
- **ARCH-022's mitigation becomes true.** Its guardrail-bypass mitigation asserts `createRuleContext()` is the only code path that can spawn a subprocess; that assertion holds only if the scanner does.
- **Third-party rule code is gated where provenance still exists.** Scanning in `writeImportedAdrs()` catches untrusted rules at the one moment the system knows they are untrusted, and refuses before writing anything.
- **The safe set is small enough to review.** Four `node:`-prefixed modules can be reasoned about exhaustively, which is not true of a ban list that must anticipate every future resolver behaviour.
- **The reflective/aliasing class is closed with one rule.** Blocking the global identifier collapses aliasing, destructuring, reflection, and global-object aliases into a single check in place of scattered per-shape member and call checks, and lets the first-party and imported scans converge.

### Negative

- **Breaking change for existing rule files.** Any `.rules.ts` importing outside the four allowed modules fails, including rules doing legitimate work by illegitimate means. A rule shelling out to a language parser must move to `ctx.ast()` ([ARCH-022](./ARCH-022-ast-aware-rule-context.md)), which is a rewrite, not a find-and-replace.
- **Legitimate helper reuse across rule files is refused.** A relative import of a shared helper is blocked along with `./evil.ts`, because the scanner never reads either. Rule files must be self-contained.
- **The allowlist is a maintenance surface.** Every genuine future need for a safe module requires an explicit review and an edit here, rather than "it wasn't banned, so it worked."
- **Static analysis remains the boundary.** The scanner still reasons about source text, and a bug in it is still an escape. The clause-4 residual is the concrete face of this: a `.constructor` reached through a runtime-computed key (`const c = "constructor"; x[c]`, and its destructured twin) needs value tracking to resolve, and blocking all computed access would reject ordinary `obj[key]`. It stays open, is asserted by an explicit regression test, and is closable only by execution-time isolation, not by more pattern-matching.
- **Rules can no longer name these globals at all, even for benign reads.** `Bun.env`, `process.platform`, and `Bun.Glob` are refused along with `Bun.spawn`, a real capability reduction for first-party rules. It is accepted because rules interact with the project only through `ctx`; a rule that genuinely wants such data is a `ctx` feature request, not a reason to reopen the alias. A rule using one of these names as a local variable or parameter (`self`, `global`) is also refused and must rename.

### Risks

- **The module boundary erodes** — a new AST construct that evaluates a module is added to the walker without being wired to the allowlist, or `ALLOWED_MODULES` is widened under delivery pressure to admit a module that can load further code.
  - **Mitigation:** every module-evaluating construct shares one code path (`checkModuleSpecifier()`), so new node types join an existing `case` list rather than a parallel check, and `tests/engine/rule-scanner-escapes.test.ts` covers each construct explicitly. The Don'ts name `node:module` as the cautionary case, and Manual Enforcement requires reviewers to establish non-shadowability and non-loading before any addition.
- **The scanner's single-file view is mistaken for a whole-program guarantee**, and a future contributor "fixes" the refusal of relative imports by following them instead.
  - **Mitigation:** the scanner is single-file by construction — refusing what it cannot read is the design, not an omission. This is stated in the Decision and the Don'ts, and the alternatives analysis in Context records why transitive scanning was rejected.
- **The test suite reports green over a hole** — a permissive assertion encodes a vulnerability as intended behaviour, or tooling normalises the escape sequence in an obfuscation fixture so the case silently degrades into testing the plain text.
  - **Mitigation:** escape regression tests are consolidated in `tests/engine/rule-scanner-escapes.test.ts`, where each case is framed as an attack that must be blocked, and reviewers are directed to read a permissive assertion there as a claim requiring justification. Obfuscation fixtures are built from a concatenated backslash constant (`const BS = "\\"`) that no formatter can collapse, and an explicit guard test asserts each fixture does **not** contain the plain text it is meant to hide.
- **A payload stops being reached while every check stays correct** — a future Bun/Node release exposes the global object or a capability under a new alias or a new `eval` path, or a schema tightening or new meriyah/ESTree node shape makes a valid node fail `safeParse` and drops it with its subtree (clause 7). In both cases `archgate check` reports a pass.
  - **Mitigation:** the block is on the identifier set, so a new alias is a one-line addition with a matching case in the "reflective and aliased access to runtime globals" block of `tests/engine/rule-scanner-escapes.test.ts`, and the first-party/imported convergence keeps that coverage identical for both entry points. For the walk, clause 7 requires `AstNodeSchema` to reject nothing a valid node can contain; the escape suite carries a "payloads behind exotic-literal receivers stay in the walk" block (RegExp and bigint receivers, banned globals/imports beside such literals, and positive controls), the `source: null` regression cases live in `tests/engine/rule-scanner.test.ts`, and Manual Enforcement directs reviewers to treat any narrowing of `AstNodeSchema` as security-relevant.

## Compliance and Enforcement

### Automated Enforcement

**This ADR carries `rules: false` deliberately.** That is a design decision, not an omission, and it should not be "fixed" by adding a companion `.rules.ts`.

The invariant here is behavioural — _a rule file cannot reach `child_process`_ — and a companion rule can only assert the implementation's shape: that `ALLOWED_MODULES` exists, that `loader.ts` calls `scanRuleSource()` before `import()`. Such rules are brittle in the benign direction (a rename fails the check while the boundary is intact) and, decisively, useless in the dangerous one: "the loader scans before importing" passes whenever the loader scans in the right order, whether or not the scan works. A structural check cannot see the difference between a boundary and the appearance of one.

Enforcement therefore lives where behaviour can actually be observed:

- **`tests/engine/rule-scanner-escapes.test.ts`** — the authoritative enforcement artifact. Every known escape is encoded as a case asserting the scanner blocks it, alongside cases asserting legitimate rule files still pass. Coverage spans module specifiers in every construct; the reflective/global class of clause 4 (aliasing, destructuring, `Reflect.get`, the three global-object aliases, the `Function`-constructor chain in both member-access and destructuring spellings, the computed-variable-key residual, and "legitimate global-adjacent code still passes" controls); the raw-text pass (bidi and invisible characters, leading-BOM tolerance, reporting through a parse failure); and obfuscated-specifier cases demonstrating the AST resolving what a text search would miss, guarded by a test asserting those fixtures are genuinely obfuscated. Message and position assertions live in `tests/engine/rule-scanner.test.ts` and `tests/engine/rule-scanner-positions.test.ts`.
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
7. The raw-text pass has not grown a search for dangerous names, and blocked code points are still spelled numerically rather than as literals or escapes. A text search for `child_process`/`Bun.spawn`/etc. would miss an obfuscated specifier like `import("\x6eode:child_process")` and false-positive on this repo's own `ARCH-007-cross-platform-subprocess-execution.rules.ts`, `ARCH-014-prefer-bun-env.rules.ts`, and `ARCH-022-ast-aware-rule-context.rules.ts`, which name these identifiers legitimately.
8. Dangerous globals are blocked by **naming** (the banned-identifier set), not by per-shape member/call checks. A newly added blocked global or `.constructor`-style property check arrives with a matching case in the reflective-globals block of the escape suite, and covers the `o.name`/`o["name"]` member spellings and the `{ name: v }` destructuring spelling via `staticPropName()`.
9. The first-party and imported scans are still converged (`scanImportedRuleSource()` delegates), so a new global block cannot be closed for one entry point and left open for the other.
10. Any narrowing of `AstNodeSchema` — a tighter union, a newly required or non-nullable field — is treated as security-relevant per clause 7: a node that fails `safeParse` is dropped with its subtree, so the change is justified against whether any valid ESTree node can now fail validation, and arrives with a coverage case in the escape suite.

### Exceptions

Any proposal to widen `ALLOWED_MODULES` beyond `node:`-prefixed specifiers, to follow imports transitively rather than refuse them, or to remove the import-time scan in `writeImportedAdrs()` MUST be documented as a separate ADR and approved by the project maintainer before implementation. Moving `.rules.ts` execution into a real sandbox (worker, subprocess, or restricted-resolver VM) is the sanctioned direction for strengthening this boundary and likewise warrants its own ADR — it would change the nature of the guarantee, not just its coverage.

## References

- [ARCH-022 — AST-Aware Rule Context](./ARCH-022-ast-aware-rule-context.md) — Depends on this boundary: its "rule authors MUST NEVER reach `Bun.spawn`/`child_process`" invariant and its guardrail-bypass mitigation are only true if the scanner holds. `ctx.ast()` is the sanctioned alternative for rules needing language tooling.
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
