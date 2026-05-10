---
id: LEGAL-002
title: Dependency License Compatibility
domain: legal
rules: true
files: ["package.json"]
---

## Context

The Archgate CLI is licensed under Apache-2.0, a permissive open-source license. When the CLI is compiled into a binary via `bun build --compile`, all runtime dependencies are bundled into the executable. This means the binary is a combined work that must comply with the license terms of every bundled dependency.

Copyleft licenses (GPL, AGPL, LGPL) impose "share-alike" requirements that could force the entire CLI to be distributed under copyleft terms — incompatible with the project's Apache-2.0 licensing. Even for devDependencies (which are not bundled), copyleft test frameworks or build tools could create legal ambiguity about the project's overall license posture.

**Alternatives considered:**

- **No automated checking** — Rely on manual review during dependency additions. Error-prone; a single copyleft transitive dependency could slip in unnoticed.
- **FOSSA or Snyk integration** — Third-party SaaS license scanners. Adds external dependency, cost, and requires API tokens in CI. Overkill for a project with only 3 production dependencies.
- **npm license-checker package** — Adds a devDependency for something achievable with a simple script. Counter to ARCH-006 (minimize dependencies).

A lightweight, self-contained script that reads `node_modules/*/package.json` license fields provides the same coverage without external dependencies or API tokens.

## Decision

All dependencies (production and development) must use licenses compatible with Apache-2.0. The project maintains an allowlist of approved permissive licenses:

| License                      | SPDX Identifier      |
| ---------------------------- | -------------------- |
| MIT License                  | MIT                  |
| Apache License 2.0           | Apache-2.0           |
| ISC License                  | ISC                  |
| BSD 2-Clause                 | BSD-2-Clause         |
| BSD 3-Clause                 | BSD-3-Clause         |
| Zero-Clause BSD              | 0BSD                 |
| Creative Commons Zero        | CC0-1.0              |
| The Unlicense                | Unlicense            |
| Blue Oak Model License       | BlueOak-1.0.0        |
| Creative Commons Attribution | CC-BY-4.0, CC-BY-3.0 |
| Python Software Foundation   | Python-2.0           |

SPDX OR expressions (e.g., `MIT OR Apache-2.0`) are allowed if at least one alternative is on the allowlist.

**Prohibited licenses include:** GPL-2.0, GPL-3.0, AGPL-3.0, LGPL-2.1, LGPL-3.0, SSPL-1.0, and any other copyleft or source-available license.

## Do's and Don'ts

### Do

- Run `bun run license:check` before adding any new dependency
- Verify transitive dependencies — a permissively-licensed package may pull in a copyleft transitive
- Add newly-encountered permissive licenses to the allowlist in `scripts/check-licenses.ts` with a comment
- Prefer dependencies with clear SPDX license identifiers in their `package.json`

### Don't

- Don't add dependencies with GPL, AGPL, LGPL, or SSPL licenses
- Don't add dependencies with no license field (`UNLICENSED` or missing) — these are "all rights reserved" by default
- Don't assume a package is permissive based on its README — always check the `license` field in `package.json`
- Don't add packages with `Custom` or proprietary license fields without explicit legal review

## Consequences

### Positive

- **Legal certainty** — Every dependency in the compiled binary is confirmed Apache-2.0-compatible
- **Distribution safety** — Users, enterprises, and downstream redistributors can rely on the project's Apache-2.0 license without hidden copyleft obligations
- **Automated enforcement** — License violations are caught in CI before merge

### Negative

- **May reject useful packages** — Some high-quality libraries use copyleft licenses (e.g., readline-sync is GPL). These cannot be used regardless of utility.
- **Allowlist maintenance** — Rare or exotic permissive licenses require manual addition to the allowlist

### Risks

- **Transitive dependency license change** — A previously-permissive dependency may change its license in a new version (e.g., the Elasticsearch SSPL relicensing).
  - **Mitigation:** `bun run license:check` runs on the installed `node_modules` tree, catching license changes on any version update.
- **Missing license field in package.json** — Some packages declare their license only in a LICENSE file, not in the `license` field. The scanner may flag these as "no license."
  - **Mitigation:** If a package is clearly permissive (LICENSE file exists) but lacks a `package.json` license field, add it to the allowlist with a comment explaining the override.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `LEGAL-002/no-copyleft-deps`: Reads `package.json` devDependencies and dependencies, cross-references against the allowlist in `scripts/check-licenses.ts`. Severity: `error` (hard blocker).
- **Script**: `bun run license:check` — scans all installed `node_modules` packages for comprehensive coverage including transitives.

### Manual Enforcement

- Dependency additions in PRs should include a note confirming license compatibility
- The `bun run license:check` script should be run after any `bun install` or lockfile update

## References

- [SPDX License List](https://spdx.org/licenses/)
- [Apache-2.0 License Compatibility](https://www.apache.org/legal/resolved.html)
- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — Governs which dependencies are allowed; this ADR governs their license compatibility
- [`scripts/check-licenses.ts`](../../scripts/check-licenses.ts) — The license scanner implementation
