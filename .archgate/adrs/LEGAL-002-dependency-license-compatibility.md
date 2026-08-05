---
id: LEGAL-002
title: Dependency License Compatibility
domain: legal
rules: true
files: ["package.json"]
---

## Context

The Archgate CLI is licensed under Apache-2.0. `bun build --compile` bundles all runtime dependencies into the executable, making the binary a combined work that must comply with the license terms of every bundled dependency.

Whether a copyleft license's "share-alike" obligations attach to a combined work depends on the license pair, the linking mode, and the distribution mode — a determination this project chooses not to make per-dependency. As policy, Archgate does not accept copyleft dependencies: it distributes a compiled binary with runtime dependencies bundled in, and takes on no obligations that would qualify its Apache-2.0 terms. devDependencies (not bundled) are held to the same policy so the project's license posture stays uniform and requires no case-by-case analysis.

**Alternatives considered:**

- **No automated checking** — Manual review at dependency-addition time is error-prone; a single copyleft transitive dependency could slip in unnoticed.
- **FOSSA or Snyk integration** — Third-party SaaS license scanners add an external dependency, cost, and API tokens in CI. Overkill given the project's minimal production dependency set (see `package.json`).
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

- Run `archgate check` (or `bun run validate`) before adding any new dependency
- Verify transitive dependencies — a permissively-licensed package may pull in a copyleft transitive
- Add newly-encountered permissive licenses to the allowlist in the LEGAL-002 `.rules.ts` file
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

- **May reject useful packages** — Some high-quality libraries use copyleft licenses (e.g., the `mariadb` connector is LGPL-2.1-or-later). These are not accepted regardless of utility.
- **Allowlist maintenance** — Rare or exotic permissive licenses require manual addition to the allowlist

### Risks

- **Transitive dependency license change** — A previously-permissive dependency may relicense in a new version (e.g., the Elasticsearch SSPL relicensing).
  - **Mitigation:** The `LEGAL-002/no-copyleft-deps` rule scans the installed `node_modules` tree on every `archgate check`, catching license changes on any version update.
- **Missing license field in package.json** — Packages that declare their license only in a LICENSE file may be flagged as "no license."
  - **Mitigation:** If a package is clearly permissive (LICENSE file exists) but lacks a `package.json` license field, add it to the allowlist with a comment explaining the override.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `LEGAL-002/no-copyleft-deps`: Scans **all** packages in `node_modules/` (direct and transitive) via glob, reads each `package.json` license field, and flags any package not on the permissive allowlist. Severity: `error` (hard blocker). Runs as part of `archgate check` (included in `bun run validate`).

### Manual Enforcement

- Dependency additions in PRs should include a note confirming license compatibility

## References

- [SPDX License List](https://spdx.org/licenses/)
- [Apache-2.0 License Compatibility](https://www.apache.org/legal/resolved.html)
- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — Governs which dependencies are allowed; this ADR governs their license compatibility
