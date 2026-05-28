---
id: DIST-001
title: Multi-Ecosystem Distribution
domain: distribution
rules: false
---

# Multi-Ecosystem Distribution

## Context

The archgate CLI is a standalone binary compiled with Bun. To maximize reach, it is distributed through multiple package managers (npm, PyPI, NuGet, Go, Maven Central, RubyGems) using a "thin shim" pattern: each package contains a minimal wrapper in the target ecosystem's language that downloads and caches the platform binary from GitHub Releases on first invocation.

## Decision

All distribution shims live under `shims/` in the main repository. Each shim is a self-contained package for its target ecosystem with zero runtime dependencies beyond the ecosystem's own standard library.

### Shared Behavioral Contract

Every shim implements the same algorithm:

1. Detect platform/architecture and map to artifact name (`archgate-darwin-arm64`, `archgate-linux-x64`, `archgate-win32-x64`)
2. Check for cached binary at `~/.archgate/bin/archgate[.exe]`
3. If missing, download from `https://github.com/archgate/cli/releases/download/v{VERSION}/{artifact}.{ext}`
4. Verify SHA256 checksum against the companion `.sha256` file
5. Extract binary with proper permissions (0755 on Unix)
6. Execute the binary, forwarding all arguments and inheriting stdio
7. Propagate the exit code

### Shared Cache

All shim packages share the same cache directory (`~/.archgate/bin/`). If the binary is already cached by any install method (npm, pip, standalone installer, etc.), no download occurs.

### Error Messages

All shims produce identical user-facing error messages on stderr:

- Unsupported platform: `archgate: Unsupported platform: {os}/{arch}\narchgate supports darwin/arm64, linux/x64, and win32/x64.`
- Download failure: `archgate: failed to download binary: {detail}\nVisit https://cli.archgate.dev/getting-started/installation/ for alternative install methods.`
- Checksum mismatch: `archgate: checksum verification failed for v{version} (expected {expected}, got {actual})`
- Download started: `archgate: binary not found, downloading v{version}...`
- Download complete: `archgate: binary downloaded successfully.`

### Version Synchronization

`package.json` `version` is the single source of truth. The `.simple-release.js` bump hook updates all shim version files automatically during the release commit. See ARCH-013 for enforcement details.

## Do's and Don'ts

### Do

- Use only the target ecosystem's standard library (zero runtime dependencies)
- Share the `~/.archgate/bin/` cache directory across all shim packages
- Verify SHA256 checksums before extracting downloaded archives
- Use identical error messages across all shims
- Add new shim version files to `.simple-release.js` and the ARCH-013 companion rules

### Don't

- Don't bundle the compiled binary into any shim package (download on demand)
- Don't add runtime dependencies to any shim package
- Don't use a different cache location per ecosystem
- Don't skip SHA256 verification

## Consequences

### Positive

- Users can install archgate through their preferred package manager without requiring Node.js or Bun
- All install methods converge on the same cached binary, avoiding duplicate downloads
- Thin packages are fast to install and have minimal footprint in each registry
- Version synchronization is automated via the release hook

### Negative

- First-run latency: the binary must be downloaded on the first invocation after install
- Multiple codebases to maintain (one per ecosystem), though the logic is simple and rarely changes
- Network dependency on GitHub Releases for the initial download

## References

- [ARCH-013 -- Version Synchronization](./ARCH-013-version-synchronization.md) -- Enforces version parity across all shim packages
- [CI-001 -- Pin GitHub Actions by Commit SHA](./CI-001-pin-github-actions-by-hash.md) -- SHA pinning for the publish-shims workflow
- [`.simple-release.js`](../../.simple-release.js) -- Release bump hook that syncs all shim versions
