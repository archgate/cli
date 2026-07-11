---
name: project-oxlint-gotchas
description: oxlint rule-specific gotchas and the custom jsPlugins convention hit repeatedly in this repo
metadata:
  type: project
---

- **Custom oxlint JS plugins live in `lint/*.ts`, registered via `jsPlugins` in `.oxlintrc.json`.** `lint/expect-expect.ts` (rule `bun-test/expect-expect`) fails any runnable `bun:test` `test()`/`it()` (incl. `.skipIf()()`, `.each()()`) with no `expect()` call, because oxlint's built-in `jest/expect-expect` doesn't recognize `bun:test`. ESLint-compatible default-export shape, runs as native TS under Bun. `lint/` is excluded from `tsconfig.json` and `knip.json` but IS linted by oxlint itself, so the plugin file must pass all oxlint rules. Enable a rule only for tests via an `overrides` entry for `tests/**/*.test.ts`. Documented in ARCH-005.
- **`unicorn/no-array-callback-reference`** — don't pass a bare function reference to `.map()`/`.find()`/`.filter()`; wrap in an arrow: `args.map((x) => asNode(x))`.
- **`require-unicode-regexp`** — regex literals need the `u` flag, including in test `toThrow(/.../u)`.
- **`prefer-regexp-test`** — `Bun.Glob.match()` returns a boolean but oxlint can't tell; suppress with `// oxlint-disable-next-line prefer-regexp-test -- Bun.Glob.match() returns boolean, not RegExp`.
- **`no-negated-condition`** — write ternaries/`if-else` with the positive condition first: `x === null ? A : B`, not `x !== null ? B : A`.
- **`no-unused-vars` on catch params** — use bare `catch { }` when the error is unused, not `catch (err) { }`.
- **`no-await-in-loop`** — sequential `await` in a `for` loop is flagged; suppress with a reason comment when the sequential order is intentional.
- **ARCH-020's `glob-scan-dot` rule matches `.scan()` inside comments too** (regex `/\.scan\(([^)]*)\)/gu`) — rephrase comments to avoid the literal `.scan()` text.
- **`oxfmt` formats markdown too** — `format:check` runs over ALL files, not just `.ts`, and normalizes markdown (e.g. `*word*` → `_word_`). The `adr-author` skill does not auto-format ADRs it writes; always run `bun run format` after editing ADR/markdown. Tripped CI on PR #372.
- **oxfmt eats spaces after inline code spans when the line contains escaped backticks inside a code span** — e.g. `` `UserError("... Run \`archgate init\` first.")` `` mis-parses span boundaries and the re-print collapses `` `code` word`` → `` `code`word`` for the REST of the line. Re-adding the spaces gets re-eaten on the next format pass. Fix the root cause: never nest `\`` escaped backticks inside an inline code span in markdown — rephrase (quote the message as plain text, put commands in their own spans). Tripped CodeRabbit on PR #467 (ARCH-011).
