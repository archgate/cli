---
name: verify-agents-run-typecheck
description: Verify/review subagents on TypeScript changes must run typecheck, not just lint+test
metadata:
  type: feedback
---

A subagent verifying a TS change must run `bun run typecheck`, not just `bun run lint` + `bun run test` + `bun run format:check`.

- During a 41-file `test.each`/`describe.each` conversion, 7 of 14 fix+verify agent pairs self-reported clean after lint+test but missed `TS6133: 'label' is declared but its value is never read` — a destructured `test.each` row param used only in the title's `%s` substitution, not the callback body. `noUnusedParameters: true` catches it; neither oxlint nor `bun test` does.
- Still run the full `bun run validate` yourself as the final gate regardless of what subagents reported — self-reported per-file checks miss project-wide issues a full `tsc --build` surfaces.
