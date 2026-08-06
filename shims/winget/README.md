# winget distribution

Build recipe and manifest source for the [winget](https://learn.microsoft.com/windows/package-manager/) package `Archgate.Archgate`.

```powershell
winget install Archgate.Archgate
```

## How this differs from the other shims

Every other directory under `shims/` is a package published to a registry, with its own implementation of the [ARCH-017](../../.archgate/adrs/ARCH-017-multi-ecosystem-distribution.md) download-and-exec contract. This one is neither.

winget installs a **portable executable** from a URL rather than a package built from source, and that executable is the Go shim in [`shims/go`](../go) cross-compiled for Windows. There is no winget-specific shim code, so this directory holds only the build script and the manifest templates:

| Path               | Role                                                            |
| ------------------ | --------------------------------------------------------------- |
| `build.ts`         | Cross-compiles the Go shim and renders the manifests            |
| `manifests/*.yaml` | winget manifest templates with `{{VERSION}}`/`{{SHA256}}` slots |

Because nothing is published _from_ this directory, it carries no `LICENSE.md` and no root-mirrored `README.md` — the two artifacts [ARCH-013](../../.archgate/adrs/ARCH-013-version-synchronization.md) synchronizes into every published shim package. It also pins no version constant: `build.ts` reads `package.json`, and the shim it compiles carries the `Version` constant the release hook already maintains in `shims/go`.

## Building

Requires the Go toolchain on `PATH`.

```bash
bun run build:winget --out-dir dist/winget
```

This produces `archgate-shim-win32-x64.exe` (~6 MB) plus the three rendered manifests. The executable is a thin shim: on first run it downloads the matching CLI binary from GitHub Releases, verifies its SHA256, caches it to `~/.archgate/bin/`, and forwards to it.

To regenerate manifests for a release whose executable is already published, skip the compile and supply the checksum:

```bash
bun run build:winget --manifests-only --version 0.51.0 --sha256 <hex>
```

## Publishing

`release-binaries.yml` builds and uploads the executable alongside the platform binaries. `publish-shims.yml` then submits a manifest update to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) with `wingetcreate`.

The very first submission is manual, since a new package goes through winget-pkgs moderation:

```bash
wingetcreate submit --token <github-pat> dist/winget
```
