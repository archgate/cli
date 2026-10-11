# Microsoft Store distribution

Build recipe and package source for the Archgate listing in the Microsoft Store, which is also what `winget` installs on Windows:

```powershell
winget install --id <productId from store.json>
```

## How this differs from the shims

Every directory under [`shims/`](../../shims) is a thin package that downloads the binary on first run ([ARCH-017](../../.archgate/adrs/ARCH-017-multi-ecosystem-distribution.md)). This package contains the compiled `archgate.exe` itself, because the point of the channel is the signature: the Store signs the package it certifies, and that signature has to cover the binary users run.

| Path               | Role                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| `AppxManifest.xml` | Package identity, execution alias, capabilities, and the version      |
| `Assets/`          | Logos the manifest references                                         |
| `store.json`       | Store product ID, read by the CLI, the publish workflow, and the docs |
| `build.ts`         | Stages the binary beside the manifest and packs it with `makeappx`    |

The manifest's `Identity` `Version` is the release written as `x.y.z.0`. The `.simple-release.js` bump hook rewrites it with every other version, and `ARCH-013/shim-version-sync` fails the build on drift. `install.ps1` repeats the product ID as a literal because it is served standalone; `ARCH-017/store-identity` keeps the two equal.

## Building

Requires Windows with the Windows SDK installed (`makeappx.exe`).

```bash
bun build src/cli.ts --compile --bytecode --minify --target bun-windows-x64 --outfile dist/archgate-win32-x64.exe
```

```bash
bun run build:msix --binary dist/archgate-win32-x64.exe --out-dir dist/msix
```

This writes `dist/msix/archgate-win32-x64.msix`, unsigned. `--stage-only` stops after laying out `dist/msix/staging/`, and `--makeappx <path>` selects a specific `makeappx.exe`.

### Installing a local build

Windows installs only signed packages. Sign the build with a certificate whose subject equals the manifest's `Publisher`, trust that certificate, then install:

```powershell
$publisher = ([xml](Get-Content distribution\msix\AppxManifest.xml)).Package.Identity.Publisher
$cert = New-SelfSignedCertificate -Type Custom -Subject $publisher -KeyUsage DigitalSignature `
  -CertStoreLocation Cert:\CurrentUser\My -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
Export-Certificate -Cert $cert -FilePath archgate-dev.cer
Import-Certificate -FilePath archgate-dev.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople   # elevated
signtool sign /fd SHA256 /sha1 $cert.Thumbprint dist\msix\archgate-win32-x64.msix
Add-AppxPackage dist\msix\archgate-win32-x64.msix
```

`smoke-test-windows.yml` runs this sequence on every pull request and checks that the execution alias works and that `archgate doctor` reports the `msstore` install method.

## What the manifest declares

- **`uap5:AppExecutionAlias`** puts `archgate` on PATH for every terminal. `AppListEntry="none"` keeps the CLI out of the Start menu.
- **`runFullTrust`** lets the binary run as an ordinary Win32 process.
- **`desktop6:FileSystemWriteVirtualization` / `RegistryWriteVirtualization` = `disabled`**, with the `unvirtualizedResources` capability they require. Windows otherwise redirects a packaged app's new files under `%APPDATA%` into a package-private copy, and archgate writes files other programs read, such as VS Code's `%APPDATA%\Code\User\settings.json`. Both `runFullTrust` and `unvirtualizedResources` are restricted capabilities, so each submission states why they are needed (Submission options → Restricted capabilities).

## Publishing

`release-binaries.yml` builds the package, attests it, and uploads it to the GitHub release. `publish-shims.yml` then submits that same file to the Store:

```bash
msstore publish archgate-win32-x64.msix --appId <productId>
```

The Store certifies the submission, signs the package, and publishes it — usually within a few business days, so the Store version trails the GitHub release until it clears.

### One-time Partner Center setup

The [Microsoft Store Developer CLI](https://learn.microsoft.com/windows/apps/publish/msstore-dev-cli/overview) publishes updates only. The product and its first submission are created by hand:

1. In [Partner Center](https://partner.microsoft.com/dashboard), reserve the product name. **Product identity** then shows the values this directory carries: `Package/Identity/Name`, `Package/Identity/Publisher`, and `Package/Properties/PublisherDisplayName` go into `AppxManifest.xml`; the **Store ID** goes into `store.json` and `install.ps1`.
2. Build the package and create the first submission in Partner Center: upload the `.msix`, complete the age rating, the Store listing, and the restricted-capability justification, then submit for certification.
3. Under **Account settings → User management → Microsoft Entra applications**, add an application with the Manager role and create a client secret for it.
4. Add the repository secrets the publish job reads: `PARTNER_CENTER_TENANT_ID`, `PARTNER_CENTER_SELLER_ID`, `PARTNER_CENTER_CLIENT_ID`, `PARTNER_CENTER_CLIENT_SECRET`. Without the client secret the job logs a warning and skips the submission.
