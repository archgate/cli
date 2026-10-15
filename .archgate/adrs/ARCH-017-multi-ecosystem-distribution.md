---
id: ARCH-017
title: Multi-Ecosystem Distribution
domain: distribution
rules: true
---

# Multi-Ecosystem Distribution

## Context

The archgate CLI is a standalone binary compiled with Bun. To maximize reach, it is distributed through multiple package managers (npm, PyPI, NuGet, Go, Maven Central, RubyGems) using a "thin shim" pattern: each package contains a minimal wrapper in the target ecosystem's language that downloads and caches the platform binary from GitHub Releases on first invocation.

The Microsoft Store is the one channel that ships the binary itself. A Windows executable is trusted by its publisher signature, and the Store signs every package it certifies — so an MSIX holding the compiled `archgate.exe` reaches users signed by Microsoft, where a shim would leave the binary it downloads unsigned. The package surfaces in `winget` through the `msstore` source, which makes `winget install` the Windows install command.

`distribution/msix/` holds what that package is built from: `AppxManifest.xml`, the logo assets, `store.json` with the Store product ID, and `build.ts`, which stages the binary beside them and runs the Windows SDK's `makeappx`. `release-binaries.yml` uploads the unsigned package next to the platform binaries, and `publish-shims.yml` submits that same file through the Microsoft Store submission API (`publish.ts`), authenticating with GitHub's OIDC token so the repository stores no Partner Center secret. A product's first submission happens in Partner Center, which also assigns the package identity the manifest carries; the API publishes every update after it.

Three properties of an installed MSIX shape the CLI:

- **The package directory is read-only**, and Windows stops a packaged app before servicing it. The binary cannot replace itself, so `archgate upgrade` names the `winget upgrade` command and exits.
- **Writes under `%APPDATA%` are virtualized.** From Windows 10 version 1903, the package's minimum, edits to an existing file there reach the real file, but a file the app creates lands in package-private storage that other programs never see. archgate therefore edits VS Code's user settings in place and, on a Store install, tells the user which setting to add when that file does not exist yet. Turning virtualization off needs the `unvirtualizedResources` capability, which the Store does not grant for this use.
- **The binary runs from the package**, not from `~/.archgate/bin/`. A Store install neither reads nor fills the shared cache.

`install.ps1` is the second way in. It runs `winget install` for the Store product and downloads the unsigned release archive only when winget cannot do the job — it is absent, the Store source is blocked, or the caller pinned a version or a directory, neither of which winget offers.

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

- Use only the target ecosystem's standard library in every shim package (zero runtime dependencies), since that code ships to users; repo-only build tooling is not bound by this
- Share the `~/.archgate/bin/` cache directory across all shim packages
- Verify SHA256 checksums before extracting downloaded archives
- Use identical error messages across all shims
- Add new shim version files to `.simple-release.js` and the ARCH-013 companion rules
- Commit any distribution value known when the version is bumped and cover it with a sync rule; reserve build-time placeholders for values that cannot exist until the artifact is built, like a checksum
- Package the compiled binary in the Store MSIX, so the binary users run carries the Store's signature
- Send a Store install to `winget upgrade` for updates — its package directory is read-only
- Mirror the product ID from `distribution/msix/store.json` in `install.ps1`, which is served standalone

### Don't

- Don't bundle the compiled binary into any shim package (download on demand)
- Don't add runtime dependencies to any shim package
- Don't use a different cache location per ecosystem
- Don't skip SHA256 verification
- Don't put a shim in the MSIX — the Store would sign a downloader, not the binary
- Don't create a file under `%APPDATA%` from a Store install — it lands in package-private storage, invisible to the program meant to read it
- Don't give `distribution/msix/` a root-mirrored `README.md` or a `LICENSE.md` — nothing publishes them
- Don't add a top-level `main` field to the root `package.json` — npm always includes the `main` entry point in the published tarball regardless of the `files` array, which would bundle the CLI source into the thin shim. The npm package exposes only `bin/archgate.cjs` (and sub-path exports like `./rules`); it needs no default entry point.

## Consequences

### Positive

- Users can install archgate through their preferred package manager without requiring Node.js or Bun
- Every shim converges on the same cached binary, avoiding duplicate downloads
- Windows users get a binary signed by Microsoft, installed and updated by `winget`, at no signing cost to the project
- Thin packages are fast to install and have minimal footprint in each registry
- Version synchronization is automated via the release hook

### Negative

- First-run latency: the binary must be downloaded on the first invocation after install
- Multiple codebases to maintain (one per ecosystem), though the logic is simple and rarely changes
- Network dependency on GitHub Releases for the initial download
- Store certification takes days, so the Store version trails a GitHub release until it clears
- A Store install keeps its own copy of the binary, apart from the `~/.archgate/bin/` cache
- Machines whose policy blocks the Microsoft Store fall back to the unsigned direct download

## Compliance and Enforcement

### Automated

- **Archgate rule** ARCH-017/no-npm-main-field: Verifies the root `package.json` has no top-level `main` field, so the npm shim never bundles the CLI entry point. Severity: error.
- **Archgate rule** ARCH-017/store-identity: Verifies `distribution/msix/store.json` holds a Store product ID, `install.ps1` and the install pages name the same product, and the manifest `Identity` `Publisher` is a Partner Center publisher ID. Severity: error.

### Manual

Code reviewers MUST verify new shims download (never bundle) the binary, add zero runtime dependencies, share the `~/.archgate/bin/` cache, and register their version file in `.simple-release.js` and the ARCH-013 companion rule. Changes to `distribution/msix/` MUST keep the compiled binary as the package payload and declare no restricted capability beyond `runFullTrust`. New code that writes under `%APPDATA%` MUST handle a Store install, where only edits to existing files reach the real file.

## References

- [ARCH-013 -- Version Synchronization](./ARCH-013-version-synchronization.md) -- Enforces version parity across all shim packages
- [CI-001 -- Pin GitHub Actions by Commit SHA](./CI-001-pin-github-actions-by-hash.md) -- SHA pinning for the publish-shims workflow
- [`.simple-release.js`](../../.simple-release.js) -- Release bump hook that syncs all shim versions
