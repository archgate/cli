---
name: typecheck-and-build
description: What tsc actually checks (include globs skip dot-directories), the generated rules.d.ts prelude, and embedding file contents via a synchronous Bun macro
metadata:
  type: project
---

## What tsc actually checks

**A directory listed in tsconfig `include` proves nothing — `tsc --showConfig` prints the resolved file list, and it is the only way to know.**

TypeScript's `include` globs skip dot-directories, so a bare `.archgate/` entry matches zero files however plausible it looks; name the path explicitly (`.archgate/adrs/*.rules.ts`) to pull them in.

Two traps compound this:

- `skipLibCheck: true` suppresses duplicate-identifier errors _between_ ambient `.d.ts` files, so two conflicting global shims coexist silently with one arbitrarily winning.
- A checked-in `.d.ts` anywhere under an included dir contributes its declarations globally — which is why `tests/fixtures` is excluded.

`.archgate/lint/*.ts` stays outside the program: it imports with a literal `.ts` extension that oxlint needs at runtime, so including it would require `allowImportingTsExtensions` or a resolver change. Importing from an unlisted dir fails with TS6307, not silent transitive inclusion.

## The rules.d.ts prelude

`bun run typecheck` generates `.archgate/rules.d.ts` before invoking tsc. The ADR companion `.rules.ts` files reach their ambient types through a triple-slash reference to that gitignored, generated file, so without the generation step a fresh clone fails with TS6053 plus a cascade of implicit-`any` errors.

**Any new script that runs `tsc` on its own needs the same prelude.**

## Embedding file contents into the binary

Use a **synchronous Bun macro**, not an import attribute.

`import text from "./f.ts" with { type: "text" }` runs and compiles fine but `tsc` rejects it — TS5097 for the `.ts` extension, TS1192 because it ignores the attribute and reads the module's real exports; an ambient wildcard cannot outrank a resolvable `.ts`.

A macro (`with { type: "macro" }`) typechecks as an ordinary typed import, and Bun inlines the return value at bundle time.

It MUST be synchronous — `readFileSync`, never `Bun.file().text()`. An async macro passes `bun run` and plain `bun build`, then fails `bun build --compile --bytecode` with `Expected "=>" but found ";"` pointing at the macro's _call site_, giving no hint that the macro is the cause.
