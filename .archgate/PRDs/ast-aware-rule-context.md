# PRD: AST-Aware Rule Context

**Status:** Draft
**Related ADR:** [ARCH-022 — AST-Aware Rule Context](../adrs/ARCH-022-ast-aware-rule-context.md)

This document covers the _what_ and _for whom_ of exposing AST inspection to `.rules.ts` authors. Architectural decisions — dependency choices, sandboxing, subprocess execution, error semantics — are governed by ARCH-022 and are not restated here. Where this PRD and the ADR appear to overlap, the ADR is authoritative for "how it must be built"; this document is authoritative for "what it must do for users."

## Problem

Rule authors writing `.rules.ts` files that need to check code _structure_ (not just text patterns) have no good option today. They fall back to line-based heuristics and regex over raw source, which are fragile against formatting variance, multi-line statements, and string-escaping edge cases. This is visible in the project's own ADR rules (`ARCH-004`'s barrel-file heuristic, `ARCH-008`'s option-shape regex checks) and would presumably affect any user writing similar structural rules for their own project.

There is no path today for a rule author to write a structural check against Python or Ruby source at all — `RuleContext` has no language-aware capability beyond generic text search.

## Goals

- Let a `.rules.ts` author write a structural (AST-based) check against a TypeScript or JavaScript file using a single, discoverable `RuleContext` method.
- Extend that same method to Python and Ruby source files, using each language's own standard-library AST facility, gated on that interpreter being available on the machine running `archgate check`.
- Make the capability discoverable and usable without requiring the rule author to understand the internal dispatch mechanism (subprocess vs. in-process parser) — that is an implementation detail per ARCH-022.
- Make failure states (missing interpreter, unparseable file) visible and actionable to whoever is running `archgate check`, not silently swallowed into a false pass.

## Non-Goals

- **A common AST vocabulary across languages.** This PRD does not require that a rule written against Python's AST "look like" one written against TypeScript's AST. Per ARCH-022, `ctx.ast()` unifies the call site and failure contract, not the returned node shape. A rule author targeting multiple languages is expected to know each target language's native AST grammar.
- **Bundled/native language parsers** (tree-sitter, WASM grammars, or similar). Out of scope for this PRD's v1; see ARCH-022's "Exceptions" section for the process to propose this later if Python/Ruby coverage via system interpreters proves insufficient.
- **Guaranteeing Python/Ruby support works on every machine.** A user running `archgate check` without `python3`/`ruby` installed cannot use a Python/Ruby structural rule — the product requirement is that this fails clearly (see "Failure Behavior" below), not that it works everywhere unconditionally.
- **Editor/IDE integration, autocomplete for AST node types, or a rule-authoring DX layer beyond documentation.** Future work, not v1.

## Users and Use Cases

Primary user: a developer or team writing `.rules.ts` files to enforce project-specific conventions via `archgate check` — the same audience already writing ADR rules today, extended to teams whose codebase includes Python or Ruby alongside (or instead of) TypeScript/JavaScript.

Representative use cases:

1. A TypeScript-only team rewrites an existing fragile regex-based rule (e.g., a barrel-file or call-shape check) to use `ctx.ast()` instead, for correctness rather than new capability.
2. A team with a Python backend wants an ADR rule enforcing a convention only expressible structurally (e.g., "no bare `except:` clauses," "all Django views subclass a specific base class") — something currently impossible to check reliably via `grep`/`grepFiles`.
3. A team with a Ruby codebase wants an equivalent structural check for a Ruby-specific convention.

## Requirements

### Functional

- `RuleContext` MUST expose the AST capability as a single method taking a file path and a language identifier, returning the parsed tree or throwing (see ARCH-022 for the exact signature and throw semantics).
- Supported languages for v1: TypeScript, JavaScript, Python, Ruby.
- The method MUST work against any file within the rule's `scopedFiles`/`changedFiles`, subject to the same sandboxing already applied to `readFile`/`glob`.

### Rollout Sequencing

TypeScript/JavaScript support ships first — it requires no new runtime dependency (reuses the existing in-process parser) and directly replaces two existing fragile rules (`ARCH-004`, `ARCH-008`) as a validating first use case, per ARCH-022. Python and Ruby support ship as a follow-on once TS/JS usage has validated the API shape and failure-reporting UX; they should not block on each other and can land independently of one another.

### Failure Behavior (product-facing)

- If the interpreter required for a requested language is unavailable, or the target file fails to parse, the rule invoking `ctx.ast()` MUST surface as a distinct, visible failure category in `archgate check` output — not as "0 violations" and not as a crash of the entire `check` run. (The mechanism for this is defined in ARCH-022; the product requirement is only that the user-visible outcome is "clearly told something is wrong," not silence.)
- The failure message shown to the user MUST make it possible to distinguish "this rule found a violation," "this rule's target file doesn't parse," and "this rule can't run at all because a required interpreter is missing" — a user debugging a red `check` run should not have to read the rule's source to tell these apart.

### Documentation Requirements

- The CLI's rule-authoring documentation MUST document, per supported language, which AST facility backs it (meriyah/ESTree for TS/JS, the standard `ast` module for Python, `Ripper` for Ruby) and link to that facility's own reference documentation, since this PRD and ARCH-022 both explicitly decline to normalize the shapes.
- Documentation MUST state plainly, near the `ctx.ast()` reference, that Python/Ruby rules require the corresponding interpreter on PATH wherever `archgate check` runs (local machines and CI), since this is a real environmental requirement introduced by this feature and not something the tool works around.
- At least one example rule per supported language SHOULD ship in documentation or the rule-authoring skill, since the lack of a shared AST vocabulary means an example in one language does not transfer to another.

## Success Criteria

- `ARCH-004`'s barrel-file rule and `ARCH-008`'s option-shape rules are rewritten to use `ctx.ast()` and pass the project's own test suite, demonstrating the TS/JS path in production use within this repository.
- At least one Python or Ruby structural rule can be authored and run successfully against a real target file, with a deliberately-broken environment (interpreter removed from PATH) producing a clear, distinguishable failure rather than a silent pass.

## Open Questions

- Should the documentation-required example rules (per language) live in this repository's own `.archgate/adrs/` as dogfooding, in the public docs site, or both?
- What is the minimum interpreter version this PRD should claim support for (Python 3.x floor, Ruby version floor)? Needs a decision before the Python/Ruby documentation ships, not before TS/JS ships.

## References

- [ARCH-022 — AST-Aware Rule Context](../adrs/ARCH-022-ast-aware-rule-context.md) — architectural decision record for the mechanism described here
- [ARCH-004 — No Barrel Files or Re-Exports](../adrs/ARCH-004-no-barrel-files.md) — first intended consumer of `ctx.ast()`
- [ARCH-008 — Typed Command Options](../adrs/ARCH-008-typed-command-options.md) — second intended consumer of `ctx.ast()`
