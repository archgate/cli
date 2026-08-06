---
id: ARCH-017
title: Multi-Ecosystem Distribution
domain: distribution
rules: true
---

# Multi-Ecosystem Distribution

## Context

The archgate CLI is a standalone binary compiled with Bun. To maximize reach, it is distributed through multiple package managers (npm, PyPI, NuGet, Go, Maven Central, RubyGems, winget) using a "thin shim" pattern: each package contains a minimal wrapper in the target ecosystem's language that downloads and caches the platform binary from GitHub Releases on first invocation.

winget is the one target that installs no package built from source. Its `portable` installer type fetches a single executable from a URL and puts it on `PATH`, so the artifact it installs is the Go shim cross-compiled for Windows rather than a seventh implementation of the contract below. `shims/winget/` therefore holds no shim implementation — only `build.ts`, which cross-compiles `shims/go` for `windows/amd64` into `archgate-shim-win32-x64.exe` and renders that executable's SHA256 into the `manifests/` sources, alongside a `README.md` documenting that recipe and the manual first submission. `build.ts` runs only from this repository and is never published, so it uses the repo's own tooling — Commander for its flags, as the CLI itself does — rather than the standard-library-only rule that binds shipped shim code.

That executable's checksum is computed from a locally built copy and rendered into the manifest, rather than read back from the published asset, so the local build has to match what ships. Go stamps `vcs.revision` and `vcs.time` into a binary by default, which makes the same source hash differently on every commit; `-buildvcs=false` removes the stamping. The toolchain is the other input to that checksum, so every workflow building the shim pins the Go version declared in `shims/go/go.mod`. `release-binaries.yml` uploads the executable next to the platform binaries, and `publish-shims.yml` submits each version's manifest update to `microsoft/winget-pkgs` with `wingetcreate`.

Because the installed executable _is_ the Go shim, a winget install converges on the same `~/.archgate/bin/` cache as every other method. Because no shim package is published from the directory, it carries neither of the two content artifacts ARCH-013 mirrors into published shim packages — no root-mirrored `README.md`, no `LICENSE.md`. The version is a different matter: the manifests state it directly, so ARCH-013 syncs and enforces it exactly as it does every other shim's. A directory-specific `README.md` is not one of those mirrored artifacts and is expected here.

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
- Ship the winget executable as a cross-compiled build of `shims/go`, so Windows has one shim implementation rather than two that can drift
- Build the winget executable with `-buildvcs=false` on the Go version pinned in `shims/go/go.mod`, so the same source and toolchain yield the same checksum and a rendered manifest keeps matching the released executable

### Don't

- Don't bundle the compiled binary into any shim package (download on demand)
- Don't add runtime dependencies to any shim package
- Don't use a different cache location per ecosystem
- Don't skip SHA256 verification
- Don't give `shims/winget/` a root-mirrored `README.md` or a `LICENSE.md` — no shim package is published from that directory, so those files would have no consumer and no source of truth to track; its own `README.md` describing the build recipe is expected. Its manifests do carry the version, in `PackageVersion` and in the two URLs that embed it, synced like every other shim
- Don't add a top-level `main` field to the root `package.json` — npm always includes the `main` entry point in the published tarball regardless of the `files` array, which would bundle the CLI source into the thin shim. The npm package exposes only `bin/archgate.cjs` (and sub-path exports like `./rules`); it needs no default entry point.

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

## Compliance and Enforcement

### Automated

- **Archgate rule** ARCH-017/no-npm-main-field: Verifies the root `package.json` has no top-level `main` field, so the npm shim never bundles the CLI entry point. Severity: error.

### Manual

Code reviewers MUST verify new shims download (never bundle) the binary, add zero runtime dependencies, share the `~/.archgate/bin/` cache, and register their version file in `.simple-release.js` and the ARCH-013 companion rule.

## References

- [ARCH-013 -- Version Synchronization](./ARCH-013-version-synchronization.md) -- Enforces version parity across all shim packages
- [CI-001 -- Pin GitHub Actions by Commit SHA](./CI-001-pin-github-actions-by-hash.md) -- SHA pinning for the publish-shims workflow
- [`.simple-release.js`](../../.simple-release.js) -- Release bump hook that syncs all shim versions
