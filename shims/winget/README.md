# winget distribution

Build recipe and manifest source for the [winget](https://learn.microsoft.com/windows/package-manager/) package `Archgate.Archgate`.

```powershell
winget install Archgate.Archgate
```

## How this differs from the other shims

Every other directory under `shims/` is a package published to a registry, with its own implementation of the [ARCH-017](../../.archgate/adrs/ARCH-017-multi-ecosystem-distribution.md) download-and-exec contract. This one is neither.

winget installs a **portable executable** from a URL rather than a package built from source, and that executable is the Go shim in [`shims/go`](../go) cross-compiled for Windows. There is no winget-specific shim code, so this directory holds only the build script and the manifests:

| Path               | Role                                                 |
| ------------------ | ---------------------------------------------------- |
| `build.ts`         | Cross-compiles the Go shim and renders the manifests |
| `manifests/*.yaml` | winget manifests, with a `{{SHA256}}` slot           |

Because nothing is published _from_ this directory, it carries no `LICENSE.md` and no root-mirrored `README.md` — the two artifacts [ARCH-013](../../.archgate/adrs/ARCH-013-version-synchronization.md) synchronizes into every published shim package.

The version is a different matter. The manifests state it directly — in `PackageVersion`, in `InstallerUrl`, and in `ReleaseNotesUrl` — so the `.simple-release.js` bump hook rewrites them alongside every other shim version, and `ARCH-013/shim-version-sync` fails the build on drift. The executable's checksum is the one value that cannot be committed, since it is unknown until the release workflow compiles the binary; `{{SHA256}}` is therefore the only slot `build.ts` fills.

## Building

Requires the Go toolchain on `PATH`.

```bash
bun run build:winget --out-dir dist/winget
```

This produces `archgate-shim-win32-x64.exe` (~6 MB) plus the three rendered manifests. The executable is a thin shim: on first run it downloads the matching CLI binary from GitHub Releases, verifies its SHA256, caches it to `~/.archgate/bin/`, and forwards to it.

To regenerate manifests for a release whose executable is already published, skip the compile and supply the checksum:

```bash
bun run build:winget --manifests-only --sha256 <hex>
```

## Publishing

`release-binaries.yml` builds and uploads the executable alongside the platform binaries. `publish-shims.yml` then submits a manifest update to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) with `wingetcreate`.

The very first submission is manual, since a new package goes through winget-pkgs moderation:

```bash
wingetcreate submit --token <github-pat> dist/winget
```
