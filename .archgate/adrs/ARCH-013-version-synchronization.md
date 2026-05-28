---
id: ARCH-013
title: Version Synchronization
domain: architecture
rules: true
files: ["package.json", "docs/**", "shims/**"]
---

# Version Synchronization

## Context

The CLI version appears in multiple locations that must stay in sync:

1. `package.json` `version` — canonical source of truth
2. `docs/astro.config.mjs` — `softwareVersion` in the JSON-LD structured data
3. `shims/pypi/pyproject.toml` — PyPI package version
4. `shims/pypi/archgate/_version.py` — Python `__version__` constant
5. `shims/nuget/Archgate.Tool/Archgate.Tool.csproj` — NuGet package version
6. `shims/go/internal/shim/shim.go` — Go `Version` constant
7. `shims/maven/pom.xml` — Maven artifact version
8. `shims/rubygem/lib/archgate/version.rb` — RubyGem `VERSION` constant

When versions diverge, users installing via different package managers get mismatched binaries. This was discovered during a consistency review where `package.json` was at `0.16.0` but `docs/astro.config.mjs` was still at `0.11.0`.

## Decision

`package.json` `version` is the single source of truth. All other version references MUST match it.

**Automated via release process:** The `.simple-release.js` bump hook updates all version locations to match `package.json` during the release commit. This is fully automated and requires no manual intervention.

The shim packages (npm, PyPI, NuGet, Go, Maven Central, RubyGems) are thin wrappers that download the platform binary from GitHub Releases. Their embedded version determines which release to download, so version drift causes download failures (404) or installs the wrong version.

## Do's and Don'ts

### Do

- Rely on `.simple-release.js` for all version sync (do not update manually)
- Use the companion rules to catch version drift in CI as a safety net
- When adding a new shim ecosystem, add its version file to `.simple-release.js` and the companion rules

### Don't

- Don't manually edit `softwareVersion` in `docs/astro.config.mjs` — the release hook handles this
- Don't manually edit version strings in any `shims/` package — the release hook handles this

## Consequences

### Positive

- Consistent version information across user-facing surfaces
- CI catches version drift before it reaches production

### Negative

- None — all version sync is automated via the release hook

## Compliance and Enforcement

### Automated Enforcement

- **Release hook** `.simple-release.js`: Syncs all version locations during `bump()`. Fully automated.
- **Archgate rule** `ARCH-013/docs-version-sync`: Checks that `softwareVersion` in `docs/astro.config.mjs` matches `package.json` version. Severity: `error`.
- **Archgate rule** `ARCH-013/shim-version-sync`: Checks that all shim package versions match `package.json` version. Severity: `error`.

## References

- [GEN-001 — Documentation Site](./GEN-001-documentation-site.md) — Docs site structure and configuration
- [ARCH-017 — Multi-Ecosystem Distribution](./ARCH-017-multi-ecosystem-distribution.md) — Shim pattern and behavioral contract
- [`.simple-release.js`](../../.simple-release.js) — Release bump hook that syncs all version locations
