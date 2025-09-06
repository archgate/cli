#!/usr/bin/env bun
/**
 * Build script: compiles Archgate CLI to standalone binaries, generates SHA-256 checksums.
 *
 * Usage:
 *   bun run scripts/build.ts                    # Build all targets
 *   bun run scripts/build.ts --target darwin-arm64
 *   bun run scripts/build.ts --target linux-x64
 */
import { statSync } from "node:fs";
import { join } from "node:path";

const ALL_TARGETS = [
  { flag: "bun-darwin-arm64", name: "archgate-darwin-arm64" },
  { flag: "bun-linux-x64", name: "archgate-linux-x64" },
] as const;

const outDir = "dist";

async function checksum(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const buf = await file.arrayBuffer();
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(buf);
  return hasher.digest("hex");
}

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(1)} MB`;
}

async function buildTarget(flag: string, name: string): Promise<void> {
  const outPath = join(outDir, name);
  console.log(`Building ${name} (target: ${flag})...`);

  const result =
    await $`bun build src/cli.ts --compile --bytecode --minify --target ${flag} --outfile ${outPath}`
      .nothrow()
      .quiet();

  if (result.exitCode !== 0) {
    console.error(`Build failed for ${name}:`);
    console.error(result.stderr.toString());
    process.exit(2);
  }

  const sha = await checksum(outPath);
  const checksumPath = `${outPath}.sha256`;
  await Bun.write(checksumPath, `${sha}  ${name}\n`);

  const size = statSync(outPath).size;
  console.log(`  ${name}: ${formatBytes(size)}`);
  console.log(`  SHA-256: ${sha}`);
}

async function main() {
  const args = process.argv.slice(2);
  const targetArg = args.indexOf("--target");
  const requestedTarget = targetArg === -1 ? null : args[targetArg + 1];

  const targets =
    requestedTarget === null
      ? ALL_TARGETS
      : ALL_TARGETS.filter((t) => t.name.endsWith(requestedTarget));

  if (targets.length === 0) {
    console.error(
      `Unknown target: ${requestedTarget}. Available: darwin-arm64, linux-x64`
    );
    process.exit(2);
  }

  // Ensure output directory exists
  await $`mkdir -p ${outDir}`.quiet();

  console.log(`Building ${targets.length} target(s)...`);
  for (const { flag, name } of targets) {
    // oxlint-disable-next-line no-await-in-loop -- sequential builds are intentional for readable output
    await buildTarget(flag, name);
  }
  console.log("Build complete.");
}

import { $ } from "bun";

await main();
