#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const https = require("https");
const zlib = require("zlib");
const path = require("path");
const fs = require("fs");

function getPlatformPackageName() {
  const { platform, arch } = process;
  if (platform === "darwin" && arch === "arm64") return "archgate-darwin-arm64";
  if (platform === "linux" && arch === "x64") return "archgate-linux-x64";
  if (platform === "win32" && arch === "x64") return "archgate-win32-x64";
  throw new Error(
    `Unsupported platform: ${platform}/${arch}\narchgate supports darwin/arm64, linux/x64, and win32/x64.`
  );
}

function getBinaryName() {
  return process.platform === "win32" ? "archgate.exe" : "archgate";
}

function getPackageVersion() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
  );
  return pkg.version;
}

function getBinaryPath() {
  const pkgName = getPlatformPackageName();
  const binaryName = getBinaryName();

  // 1. Try the platform-specific optional dependency (normal path).
  try {
    const pkgDir = path.dirname(require.resolve(`${pkgName}/package.json`));
    const binaryPath = path.join(pkgDir, "bin", binaryName);
    if (fs.existsSync(binaryPath)) return binaryPath;
  } catch {
    /* platform package not installed */
  }

  // 2. Fallback: binary downloaded into our own bin/ by postinstall or a
  //    previous on-demand download.
  const fallbackPath = path.join(__dirname, binaryName);
  if (fs.existsSync(fallbackPath)) return fallbackPath;

  return null;
}

// ---------------------------------------------------------------------------
// On-demand download from the npm registry
// ---------------------------------------------------------------------------

function fetchWithRedirects(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          fetchWithRedirects(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} returned status ${res.statusCode}`));
          return;
        }
        resolve(res);
      })
      .on("error", reject);
  });
}

/** Strip null bytes from a buffer-decoded string. */
function stripNulls(str) {
  const idx = str.indexOf(String.fromCodePoint(0));
  return idx === -1 ? str : str.slice(0, idx);
}

/**
 * Download the platform-specific npm package tarball and extract the binary.
 * Returns the path to the downloaded binary.
 */
async function downloadBinary() {
  const pkgName = getPlatformPackageName();
  const version = getPackageVersion();
  const binaryName = getBinaryName();

  const url = `https://registry.npmjs.org/${pkgName}/-/${pkgName}-${version}.tgz`;
  console.error(
    `archgate: binary not found, downloading ${pkgName}@${version}...`
  );

  const res = await fetchWithRedirects(url);

  const binDir = __dirname;
  const destPath = path.join(binDir, binaryName);

  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    const chunks = [];
    const expectedSuffix = `bin/${binaryName}`;
    let found = false;

    res.pipe(gunzip);
    gunzip.on("data", (chunk) => chunks.push(chunk));
    gunzip.on("end", () => {
      const data = Buffer.concat(chunks);
      let offset = 0;

      while (offset + 512 <= data.length) {
        const header = data.subarray(offset, offset + 512);
        offset += 512;

        // Empty header block signals end of archive
        if (header.every((b) => b === 0)) break;

        let name = stripNulls(header.subarray(0, 100).toString("utf8"));
        const prefix = stripNulls(header.subarray(345, 500).toString("utf8"));
        if (prefix) name = `${prefix}/${name}`;

        const sizeStr = stripNulls(
          header.subarray(124, 136).toString("utf8")
        ).trim();
        const size = parseInt(sizeStr, 8) || 0;
        const blocks = Math.ceil(size / 512);
        const fileData = data.subarray(offset, offset + size);
        offset += blocks * 512;

        if (name.endsWith(expectedSuffix)) {
          fs.writeFileSync(destPath, fileData, { mode: 0o755 });
          found = true;
          break;
        }
      }

      if (found) {
        console.error(`archgate: binary downloaded successfully.`);
        resolve(destPath);
      } else {
        reject(
          new Error(`Could not find ${expectedSuffix} in tarball from ${url}`)
        );
      }
    });

    gunzip.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let binary = getBinaryPath();

  // If the binary is missing (optional dep skipped AND postinstall blocked),
  // download it on-demand from the npm registry.
  if (!binary) {
    try {
      binary = await downloadBinary();
    } catch (err) {
      console.error(
        `archgate: failed to download binary: ${err.message}\n` +
          `Try reinstalling: npm install archgate`
      );
      process.exit(2);
    }
  }

  try {
    execFileSync(binary, process.argv.slice(2), { stdio: "inherit" });
  } catch (e) {
    if (typeof e.status === "number") process.exit(e.status);
    console.error(e.message);
    process.exit(2);
  }
}

main();
