---
id: ARCH-019
title: Interactive Prompts via withPromptFix
domain: architecture
rules: true
files: ["src/**/*.ts"]
---

# Interactive Prompts via withPromptFix

## Context

When `inquirer` creates a readline interface on Windows, it enables Virtual Terminal Processing (VTP) and sets the console flag `DISABLE_NEWLINE_AUTO_RETURN`. That flag is **never restored** after the prompt closes. The consequence is global and persistent: once any inquirer prompt has run, a bare `\n` no longer returns the cursor to column 0 for **all subsequent output** in the same process — not just during the prompt. Tables, summaries, and multi-line messages printed after an interactive flow render as a staircase.

An earlier per-prompt `cursorTo(process.stdout, 0)` fix only corrected the cursor position on the answer line; it did not address the console-mode change, so later output was still broken.

The root-cause fix lives in `src/helpers/prompt.ts`, which exports `withPromptFix()`. It applies an idempotent, permanent patch to `process.stdout.write` that translates bare `\n` to `\r\n` (via the `(?<!\r)\n` pattern) and resets the cursor to column 0 after each prompt. Because the damage is process-global, the fix only works if **every** inquirer prompt goes through `withPromptFix()` — a single unwrapped prompt re-breaks newline handling for the rest of the process.

### Alternatives Analysis

**Wrap each prompt individually with ad-hoc cursor fixes**: Insufficient — it doesn't undo the console-mode change, only the cursor position. Rejected.

**Patch `process.stdout.write` once at startup unconditionally**: Pays the patch cost (and behavior change) even for runs that never prompt, and is harder to reason about. `withPromptFix()` applies the patch lazily on first prompt and is idempotent thereafter. Chosen.

**Mandatory wrapper at every call site (`withPromptFix(() => inquirer.prompt(...))`)**: Keeps the fix co-located with the prompt and is mechanically checkable. Chosen.

## Decision

Every `inquirer.prompt(...)` call MUST be wrapped in `withPromptFix(() => ...)` from `src/helpers/prompt.ts`. There are no exceptions: one unwrapped prompt corrupts newline handling for the remainder of the process.

Note: `inquirer` itself is loaded lazily (see ARCH-018). The `withPromptFix` wrapper is independent of how `inquirer` is imported — it governs how the prompt is _invoked_.

## Do's and Don'ts

### Do

- **DO** wrap every prompt: `const answer = await withPromptFix(() => inquirer.prompt([...]))`
- **DO** import `withPromptFix` from `src/helpers/prompt.ts` (or load it dynamically alongside `inquirer`)
- **DO** keep `withPromptFix` idempotent and the single source of the stdout patch

### Don't

- **DON'T** call `inquirer.prompt(...)` directly without the wrapper
- **DON'T** reimplement the cursor/newline fix at individual call sites — funnel everything through `withPromptFix`
- **DON'T** assume "it works on my machine" — the bug is Windows-only and does not reproduce on macOS/Linux

## Consequences

### Positive

- **Correct multi-line output on Windows** after any interactive flow
- **Single point of truth** for the console fix; call sites stay simple
- **Mechanically enforceable** — the wrapper presence is checkable

### Negative

- **Boilerplate** at every prompt call site (`withPromptFix(() => ...)`)

### Risks

- **A new prompt added without the wrapper** silently re-breaks newline handling for the rest of the run. **Mitigation:** the companion rule flags any `inquirer.prompt(` not preceded by (or on the same line as) `withPromptFix`.

## Compliance and Enforcement

### Automated

- **Archgate rule** ARCH-019/inquirer-prompt-wrapped: Scans `src/**/*.ts` for `inquirer.prompt(` calls and reports any that are not wrapped in `withPromptFix` (checked on the same line or the immediately-preceding non-blank line). Comment lines are ignored. Severity: error.

### Manual

Code reviewers MUST verify any new interactive flow wraps its prompts in `withPromptFix` and does not introduce a competing stdout/cursor patch.

## References

- [ARCH-018: Lazy-Load Heavy Dependencies](./ARCH-018-lazy-load-heavy-dependencies.md) — `inquirer` is loaded lazily; this ADR governs how its prompts are invoked
- [`src/helpers/prompt.ts`](../../src/helpers/prompt.ts) — defines `withPromptFix()` and the stdout patch
