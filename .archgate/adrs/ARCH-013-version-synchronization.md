---
id: ARCH-013
title: Version Synchronization
domain: architecture
rules: true
files: ["package.json", "docs/**"]
---

# Version Synchronization

## Context

The CLI version appears in multiple locations that must stay in sync:

1. `package.json` `version` — canonical source of truth
2. `docs/astro.config.mjs` — `softwareVersion` in the JSON-LD structured data

When versions diverge, search engines display outdated version info. This was discovered during a consistency review where `package.json` was at `0.16.0` but `docs/astro.config.mjs` was still at `0.11.0`.

## Decision

`package.json` `version` is the single source of truth. All other version references MUST match it.

**Automated via release process:** The `.simple-release.js` bump hook updates `softwareVersion` in `docs/astro.config.mjs` to match `package.json`. This is fully automated and requires no manual intervention.

## Do's and Don'ts

### Do

- Rely on `.simple-release.js` for `softwareVersion` sync (do not update manually)
- Use the companion rules to catch version drift in CI as a safety net

### Don't

- Don't manually edit `softwareVersion` in `docs/astro.config.mjs` — the release hook handles this

## Consequences

### Positive

- Consistent version information across user-facing surfaces
- CI catches version drift before it reaches production

### Negative

- None — all version sync is automated via the release hook

## Compliance and Enforcement

### Automated Enforcement

- **Release hook** `.simple-release.js`: Syncs `docs/astro.config.mjs` `softwareVersion` during `bump()`. Fully automated.
- **Archgate rule** `ARCH-013/docs-version-sync`: Checks that `softwareVersion` in `docs/astro.config.mjs` matches `package.json` version. Severity: `error`.

## References

- [GEN-001 — Documentation Site](./GEN-001-documentation-site.md) — Docs site structure and configuration
- [`.simple-release.js`](../../.simple-release.js) — Release bump hook that syncs softwareVersion
