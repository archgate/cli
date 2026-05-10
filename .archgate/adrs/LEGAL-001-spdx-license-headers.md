---
id: LEGAL-001
title: SPDX License Headers
domain: legal
rules: true
files: ["src/**/*.ts", "tests/**/*.ts"]
---

## Context

The Archgate CLI is licensed under Apache-2.0. SPDX (Software Package Data Exchange) license identifiers provide a machine-readable, unambiguous way to declare the license of each source file. This eliminates ambiguity about which license applies to any given file and enables automated compliance tooling to verify license declarations at scale.

Without per-file license identifiers, downstream consumers (enterprises, redistributors, compliance scanners) must infer the license from the root LICENSE.md file — a fragile assumption that breaks when files are extracted, copied, or bundled outside the original repository context.

**Alternatives considered:**

- **Root LICENSE.md only** — Covers the project as a whole but provides no per-file signal. Files extracted in isolation (e.g., copy-pasted utilities, bundled snippets) lose their license provenance.
- **Full license header blocks** — Includes the entire license notice in every file. Verbose, creates noise, and adds maintenance burden if the copyright year or holder changes.
- **REUSE 3.0 specification** — A comprehensive approach using `.reuse/dep5` files for bulk declarations. More complex than needed for a single-license project where all files share the same license.

SPDX-License-Identifier comments are the lightest-weight solution that provides per-file legal clarity, is recognized by all major compliance scanners (FOSSA, Snyk, Black Duck, npm license-checker), and is trivial to maintain.

## Decision

Every TypeScript source file in `src/` and `tests/` must begin with an SPDX license identifier and copyright notice:

```typescript
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
```

For files with a shebang line (`#!/usr/bin/env bun`), the SPDX header must appear immediately after the shebang:

```typescript
#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
```

## Do's and Don'ts

### Do

- Add the SPDX header as the first two lines of every new `.ts` file in `src/` or `tests/`
- Place the header after the shebang line when one is present (only `src/cli.ts`)
- Use the exact format: `// SPDX-License-Identifier: Apache-2.0` followed by `// Copyright 2026 Archgate`
- Run `bun run scripts/add-spdx-headers.ts` to bulk-add headers to new files

### Don't

- Don't use block comments (`/* */`) for the SPDX header — scanners expect `//` single-line format
- Don't add SPDX headers to non-TypeScript files (JSON, YAML, Markdown) — they are covered by the root LICENSE.md
- Don't modify the copyright year without a project-wide decision
- Don't add additional license identifiers (e.g., dual licensing) without updating this ADR

## Consequences

### Positive

- **Unambiguous per-file licensing** — Every source file declares its license in a machine-readable format
- **Compliance scanner compatibility** — FOSSA, Snyk, and npm license-checker recognize SPDX identifiers automatically
- **Downstream safety** — Files extracted or bundled independently retain their license provenance
- **Apache-2.0 Section 4(a) alignment** — "You must give any other recipients of the Work a copy of this License" — per-file identifiers serve as a lightweight form of notice

### Negative

- **Two extra lines per file** — Minor visual noise; mitigated by being at the very top (above imports)
- **Year maintenance** — If copyright year changes, all files need updating (mitigated by the bulk script)

### Risks

- **Developers forget on new files** — The `LEGAL-001/spdx-header-present` rule catches this automatically in CI.
  - **Mitigation:** Automated rule blocks PRs that add `.ts` files without the header.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `LEGAL-001/spdx-header-present`: Scans all scoped `.ts` files and verifies the SPDX identifier is present in the first 3 lines. Severity: `error` (hard blocker).

### Manual Enforcement

None required — fully automated.

## References

- [SPDX License List](https://spdx.org/licenses/)
- [REUSE Software recommendations](https://reuse.software/spec/)
- [Apache-2.0 License, Section 4](https://www.apache.org/licenses/LICENSE-2.0#redistribution)
