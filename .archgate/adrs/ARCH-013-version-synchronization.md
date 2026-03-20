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

1. `package.json` — canonical source of truth for the CLI version
2. `docs/astro.config.mjs` — `softwareVersion` in the JSON-LD structured data

When versions diverge, search engines display outdated version info and users may be confused about which version the docs describe. This was discovered during a consistency review where `package.json` was at `0.16.0` but `docs/astro.config.mjs` was still at `0.11.0`.

## Decision

`package.json` is the single source of truth for the CLI version. All other version references MUST be updated when `package.json` changes.

The companion rule checks that `docs/astro.config.mjs` contains the same version as `package.json`.

## Do's and Don'ts

### Do

- Update all version references when bumping `package.json`
- Use the companion rule to catch version drift in CI

### Don't

- Don't hardcode version strings in docs without keeping them in sync with `package.json`

## Consequences

### Positive

- Consistent version information across all user-facing surfaces
- CI catches version drift automatically

### Negative

- Extra step when bumping versions (though the automated release process should handle this)

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-013/docs-version-sync`: Checks that `softwareVersion` in `docs/astro.config.mjs` matches `package.json` version. Severity: `error`.

## References

- [GEN-001 — Documentation Site](./GEN-001-documentation-site.md) — Docs site structure and configuration
