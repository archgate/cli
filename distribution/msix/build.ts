// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Packs the compiled Windows binary into the MSIX submitted to the Microsoft
 * Store. The package is left unsigned: the Store signs it during certification.
 *
 * @example
 * ```bash
 * bun run build:msix --binary dist/archgate-win32-x64.exe --out-dir dist/msix
 * ```
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Command } from "@commander-js/extra-typings";

/** Release asset name of the package. */
export const MSIX_ARTIFACT_NAME = "archgate-win32-x64.msix";

/** Where the Windows SDK installs its versioned tool directories. */
const WINDOWS_KITS_BIN = join(
  "C:\\",
  "Program Files (x86)",
  "Windows Kits",
  "10",
  "bin"
);

const IDENTITY_VERSION_PATTERN =
  /<Identity\b[^>]*\bVersion="(\d+\.\d+\.\d+)\.0"/u;

/**
 * The `x.y.z` release an `AppxManifest.xml` declares. MSIX versions carry four
 * parts and the Store reserves the last, so it is always `0`.
 *
 * @throws If the manifest has no `Identity` version of the form `x.y.z.0`.
 */
export function readManifestVersion(manifestXml: string): string {
  const version = IDENTITY_VERSION_PATTERN.exec(manifestXml)?.[1];
  if (version === undefined) {
    throw new Error(
      'AppxManifest.xml has no <Identity Version="x.y.z.0"> attribute'
    );
  }
  return version;
}

/** Compares dotted numeric versions such as `10.0.26100.0`. */
function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Locates `makeappx.exe` in the newest installed Windows SDK.
 *
 * @returns The executable's path, or `null` when no SDK under `kitsBinDir`
 * ships one.
 */
export async function findMakeAppx(
  kitsBinDir: string = WINDOWS_KITS_BIN
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(kitsBinDir);
  } catch {
    return null;
  }

  const candidates = entries
    .filter((name) => /^\d+(?:\.\d+)+$/u.test(name))
    .sort(compareVersions)
    .reverse()
    .map((version) => join(kitsBinDir, version, "x64", "makeappx.exe"));

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Lays out the package contents: the binary as `archgate.exe`, the manifest,
 * and the logo assets. Any previous contents of `stagingDir` are removed, since
 * `makeappx` packs every file it finds there.
 *
 * @throws If the manifest's version differs from `expectedVersion` — the Store
 * rejects a resubmitted version, and one behind `package.json` would publish a
 * release under the wrong number.
 */
export async function stagePackage(options: {
  binary: string;
  sourceDir: string;
  stagingDir: string;
  expectedVersion: string;
}): Promise<void> {
  const manifestPath = join(options.sourceDir, "AppxManifest.xml");
  const manifestVersion = readManifestVersion(
    await Bun.file(manifestPath).text()
  );
  if (manifestVersion !== options.expectedVersion) {
    throw new Error(
      `AppxManifest.xml version ${manifestVersion} does not match package.json version ${options.expectedVersion}`
    );
  }
  if (!existsSync(options.binary)) {
    throw new Error(`Binary not found: ${options.binary}`);
  }

  await rm(options.stagingDir, { recursive: true, force: true });
  await mkdir(options.stagingDir, { recursive: true });
  await cp(options.binary, join(options.stagingDir, "archgate.exe"));
  await cp(manifestPath, join(options.stagingDir, "AppxManifest.xml"));
  await cp(
    join(options.sourceDir, "Assets"),
    join(options.stagingDir, "Assets"),
    { recursive: true }
  );
}

/**
 * Runs `makeappx pack` over a staged directory.
 *
 * @throws If `makeappx` exits non-zero.
 */
async function packMsix(options: {
  makeappx: string;
  stagingDir: string;
  outFile: string;
}): Promise<void> {
  const proc = Bun.spawn(
    [
      options.makeappx,
      "pack",
      "/o",
      "/d",
      resolve(options.stagingDir),
      "/p",
      resolve(options.outFile),
    ],
    { stdout: "inherit", stderr: "inherit" }
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`makeappx pack failed with exit code ${exitCode}`);
  }
}

interface CliOptions {
  binary: string;
  outDir: string;
  makeappx?: string | undefined;
  stageOnly: boolean;
}

/**
 * Parses the script's command-line arguments.
 *
 * @throws {CommanderError} If an option is unknown or its value is missing.
 */
export function parseArgs(argv: readonly string[]): CliOptions {
  return new Command()
    .name("build:msix")
    .description("Pack the Windows binary into the Microsoft Store MSIX")
    .option(
      "--binary <path>",
      "compiled Windows executable",
      join("dist", "archgate-win32-x64.exe")
    )
    .option("--out-dir <dir>", "output directory", join("dist", "msix"))
    .option("--makeappx <path>", "makeappx.exe to use in place of the SDK copy")
    .option("--stage-only", "lay out the package without packing it", false)
    .exitOverride()
    .parse(argv, { from: "user" })
    .opts();
}

async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));
  const repoRoot = join(import.meta.dir, "..", "..");
  const pkg: unknown = await Bun.file(join(repoRoot, "package.json")).json();
  const expectedVersion =
    typeof pkg === "object" && pkg !== null && "version" in pkg
      ? String(pkg.version)
      : "";

  const stagingDir = join(options.outDir, "staging");
  await stagePackage({
    binary: options.binary,
    sourceDir: import.meta.dir,
    stagingDir,
    expectedVersion,
  });
  console.log(`Staged ${stagingDir}`);
  if (options.stageOnly) return;

  const makeappx = options.makeappx ?? (await findMakeAppx());
  if (makeappx === null) {
    throw new Error(
      `makeappx.exe not found under ${WINDOWS_KITS_BIN}. Install the Windows SDK or pass --makeappx <path>.`
    );
  }

  const outFile = join(options.outDir, MSIX_ARTIFACT_NAME);
  await packMsix({ makeappx, stagingDir, outFile });
  console.log(`Built ${outFile}`);
}

if (import.meta.main) {
  await main();
}
