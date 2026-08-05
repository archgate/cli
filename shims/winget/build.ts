/**
 * Generates the winget distribution artifacts: the portable shim executable
 * cross-compiled from `shims/go`, and the winget manifests rendered from the
 * templates in `manifests/`.
 *
 * @example
 * ```bash
 * bun run build:winget --out-dir dist/winget
 * bun run build:winget --manifests-only --version 0.51.0 --sha256 <hex>
 * ```
 */

import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/** winget package identifier, as submitted to microsoft/winget-pkgs. */
export const PACKAGE_IDENTIFIER = "Archgate.Archgate";

/** Release asset name for the portable shim executable. */
export const SHIM_ARTIFACT_NAME = "archgate-shim-win32-x64.exe";

const RELEASE_BASE_URL = "https://github.com/archgate/cli/releases/download";
const PLACEHOLDER_PATTERN = /\{\{([A-Z0-9_]+)\}\}/gu;

/** Values substituted into the manifest templates. */
export interface ManifestValues {
  /** CLI version without a leading `v` (e.g. `0.51.0`). */
  version: string;
  /** SHA256 of the shim executable, hex-encoded. */
  sha256: string;
}

/**
 * Builds the GitHub Releases URL the winget manifest points at.
 *
 * @param version - CLI version without a leading `v`.
 */
export function installerUrl(version: string): string {
  return `${RELEASE_BASE_URL}/v${version}/${SHIM_ARTIFACT_NAME}`;
}

/**
 * Substitutes `{{PLACEHOLDER}}` tokens in a manifest template.
 *
 * winget rejects a manifest containing an unsubstituted token only after a
 * submission round-trip, so an unresolved placeholder fails here instead.
 *
 * @throws If any placeholder remains unresolved after substitution.
 */
export function renderManifest(
  template: string,
  values: ManifestValues
): string {
  const substitutions: Record<string, string> = {
    VERSION: values.version,
    SHA256: values.sha256.toUpperCase(),
    INSTALLER_URL: installerUrl(values.version),
  };

  const rendered = template.replaceAll(
    PLACEHOLDER_PATTERN,
    (match: string, key: string) => substitutions[key] ?? match
  );

  const unresolved = [...rendered.matchAll(PLACEHOLDER_PATTERN)].map(
    (match) => match[0]
  );
  if (unresolved.length > 0) {
    const unique = [...new Set(unresolved)].join(", ");
    throw new Error(`Unresolved manifest placeholder(s): ${unique}`);
  }

  return rendered;
}

/** Hex-encoded SHA256 of a file's contents. */
export async function computeSha256(filePath: string): Promise<string> {
  const bytes = await Bun.file(filePath).arrayBuffer();
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

/**
 * Cross-compiles the Go shim to a Windows executable.
 *
 * `-trimpath` and `-s -w` keep the artifact reproducible and small, since the
 * shim only downloads and execs the real binary. `outFile` is resolved against
 * the current directory because `go build` runs inside the module directory.
 *
 * @throws If the Go toolchain is missing or the build exits non-zero.
 */
export async function buildShimExecutable(options: {
  goDir: string;
  outFile: string;
}): Promise<void> {
  const proc = Bun.spawn(
    [
      "go",
      "build",
      "-trimpath",
      "-ldflags",
      "-s -w",
      "-o",
      resolve(options.outFile),
      "./cmd/archgate",
    ],
    {
      cwd: options.goDir,
      env: { ...Bun.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
      stdout: "inherit",
      stderr: "inherit",
    }
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`go build failed with exit code ${exitCode}`);
  }
}

/**
 * Renders every `.yaml` template in `templatesDir` into `outDir`.
 *
 * @returns Absolute paths of the rendered manifests, sorted by file name.
 */
export async function renderManifests(options: {
  templatesDir: string;
  outDir: string;
  values: ManifestValues;
}): Promise<string[]> {
  const entries = (await readdir(options.templatesDir))
    .filter((name) => name.endsWith(".yaml"))
    .sort();

  if (entries.length === 0) {
    throw new Error(`No manifest templates found in ${options.templatesDir}`);
  }

  await mkdir(options.outDir, { recursive: true });

  return Promise.all(
    entries.map(async (name) => {
      const template = await Bun.file(join(options.templatesDir, name)).text();
      const outPath = join(options.outDir, name);
      await Bun.write(outPath, renderManifest(template, options.values));
      return outPath;
    })
  );
}

interface CliOptions {
  outDir: string;
  version: string | undefined;
  sha256: string | undefined;
  manifestsOnly: boolean;
}

/** Parses the script's command-line arguments. */
export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    outDir: join("dist", "winget"),
    version: undefined,
    sha256: undefined,
    manifestsOnly: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "--out-dir":
        options.outDir = argv[++index] ?? options.outDir;
        break;
      case "--version":
        options.version = argv[++index];
        break;
      case "--sha256":
        options.sha256 = argv[++index];
        break;
      case "--manifests-only":
        options.manifestsOnly = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.manifestsOnly && options.sha256 === undefined) {
    throw new Error("--manifests-only requires --sha256 <hex>");
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));
  const repoRoot = join(import.meta.dir, "..", "..");

  const pkg = (await Bun.file(join(repoRoot, "package.json")).json()) as {
    version: string;
  };
  const version = options.version ?? pkg.version;

  let sha256 = options.sha256;
  if (!options.manifestsOnly) {
    const outFile = join(options.outDir, SHIM_ARTIFACT_NAME);
    await mkdir(options.outDir, { recursive: true });
    await buildShimExecutable({
      goDir: join(repoRoot, "shims", "go"),
      outFile,
    });
    sha256 = await computeSha256(outFile);
    console.log(`Built ${outFile}`);
  }

  const written = await renderManifests({
    templatesDir: join(import.meta.dir, "manifests"),
    outDir: options.outDir,
    values: { version, sha256: sha256 ?? "" },
  });

  console.log(`Rendered ${PACKAGE_IDENTIFIER} manifests for v${version}:`);
  for (const path of written) {
    console.log(`  ${path}`);
  }
  console.log(`InstallerSha256: ${(sha256 ?? "").toUpperCase()}`);
}

if (import.meta.main) {
  await main();
}
