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
2. `package.json` `optionalDependencies` — platform-specific npm packages (`archgate-darwin-arm64`, `archgate-linux-x64`, `archgate-win32-x64`) must match the CLI version
3. `docs/astro.config.mjs` — `softwareVersion` in the JSON-LD structured data

When versions diverge, npm installs pull mismatched platform binaries and search engines display outdated version info. This was discovered during a consistency review where `package.json` was at `0.16.0` but `docs/astro.config.mjs` was still at `0.11.0`.

## Decision

`package.json` `version` is the single source of truth. All other version references MUST match it.

**Automated via release process:** The `.simple-release.js` bump hook already syncs `optionalDependencies` versions during the release workflow — it reads `package.json` after the version bump and updates all `optionalDependencies` entries to match. This is fully automated and requires no manual intervention.

**Automated via release process:** The `.simple-release.js` bump hook also updates `softwareVersion` in `docs/astro.config.mjs` to match `package.json`. Both syncs are fully automated.

## Do's and Don'ts

### Do

- Rely on `.simple-release.js` for both `optionalDependencies` and `softwareVersion` sync (do not update manually)
- Use the companion rules to catch version drift in CI as a safety net

### Don't

- Don't manually edit `optionalDependencies` versions — the release hook handles this
- Don't manually edit `softwareVersion` in `docs/astro.config.mjs` — the release hook handles this

## Consequences

### Positive

- Consistent version information across npm packages and user-facing surfaces
- CI catches version drift before it reaches production
- Platform-specific npm packages always match the CLI version

### Negative

- None — all version sync is automated via the release hook

## Compliance and Enforcement

### Automated Enforcement

- **Release hook** `.simple-release.js`: Syncs `optionalDependencies` versions and `docs/astro.config.mjs` `softwareVersion` during `bump()`. Fully automated.
- **Archgate rule** `ARCH-013/docs-version-sync`: Checks that `softwareVersion` in `docs/astro.config.mjs` matches `package.json` version. Severity: `error`.
- **Archgate rule** `ARCH-013/optional-deps-version-sync`: Checks that all `optionalDependencies` versions match `package.json` version. Severity: `error`.

## References

- [GEN-001 — Documentation Site](./GEN-001-documentation-site.md) — Docs site structure and configuration
- [`.simple-release.js`](../../.simple-release.js) — Release bump hook that syncs optionalDependencies
