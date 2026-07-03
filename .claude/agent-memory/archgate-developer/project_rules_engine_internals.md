---
name: project-rules-engine-internals
description: Gotchas in the ADR rules engine and command-option parsing internals (glob, commander, code sharing, review verification)
metadata:
  type: project
---

- **`Bun.Glob.scan()` silently fails for brace patterns with path separators.** `new Bun.Glob("svc/{src/env.ts,env.ts}").scan(...)` returns zero results (no error) while `.match()` works — the scanner wasn't updated when the match engine's brace expansion was rewritten in Bun 1.2.3. Filed upstream: [oven-sh/bun#32596](https://github.com/oven-sh/bun/issues/32596). Workaround: `expandBracePattern()` in `src/engine/runner.ts` pre-expands `/`-containing brace groups before scanning; applied in `ctx.glob()`, `ctx.grepFiles()`, `resolveScopedFiles()`.
- **Commander hoists parent-known options away from nested subcommands.** If a parent and child subcommand declare the same option (e.g. `session-context <editor>` and `<editor> show` both taking `--max-entries`), commander parses the flag onto the PARENT regardless of argv position — the child's `opts` silently gets `undefined`. Read merged values via `command.optsWithGlobals()` (third action param) and add a regression test through the full `parseAsync` path. Shipped broken in v0.46.0, fixed in PR #448.
- **Cross-command I/O sharing: export from the existing command file, don't create a new shared file.** ARCH-002 forbids `console.log` in helpers; ARCH-001/ARCH-016 require a `register*Command` export + docs heading for any new command file. Correct pattern: export the shared functions from the command file that already defines them (e.g. `plugin/install.ts` exports `installForEditor()`/`printManualInstructions()`) and import them elsewhere. Applied in `upgrade.ts`.
- **Verify a reviewer sub-agent's ADR citation against the ADR's actual text before blocking.** A haiku review agent flagged "await on a synchronous helper" as an ARCH-012 violation; ARCH-012 only mandates try-catch boundaries/exit codes, and automated rules passed. Re-read the cited ADR's Decision/Do's before accepting a FAIL. A finding citing no ADR (self-labeled "ARCH-NONE") can never block — recurred 2026-07-01 with the same nit.
