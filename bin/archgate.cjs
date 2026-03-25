#!/usr/bin/env node
"use strict";

const { execFileSync, execSync } = require("child_process");
const https = require("https");
const zlib = require("zlib");
const path = require("path");
const fs = require("fs");
const os = require("os");

function getArtifactName() {
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

function getCacheDir() {
  return path.join(os.homedir(), ".archgate", "bin");
}

function getPackageVersion() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
  );
  return pkg.version;
}

function getBinaryPath() {
  const binaryName = getBinaryName();
  const cachePath = path.join(getCacheDir(), binaryName);
  if (fs.existsSync(cachePath)) return cachePath;
  return null;
}

// ---------------------------------------------------------------------------
// On-demand download from GitHub Releases
// ---------------------------------------------------------------------------

function fetchWithRedirects(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "archgate-cli" } }, (res) => {
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
 * Download the platform binary from GitHub Releases and cache it.
 * Returns the path to the downloaded binary.
 */
async function downloadBinary() {
  const artifactName = getArtifactName();
  const version = getPackageVersion();
  const binaryName = getBinaryName();
  const isWin = process.platform === "win32";
  const ext = isWin ? "zip" : "tar.gz";

  const url = `https://github.com/archgate/cli/releases/download/v${version}/${artifactName}.${ext}`;
  console.error(`archgate: binary not found, downloading v${version}...`);

  const cacheDir = getCacheDir();
  fs.mkdirSync(cacheDir, { recursive: true });
  const destPath = path.join(cacheDir, binaryName);

  if (isWin) {
    // Download zip to temp file, extract with PowerShell
    const res = await fetchWithRedirects(url);
    const chunks = [];
    await new Promise((resolve, reject) => {
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", resolve);
      res.on("error", reject);
    });
    const tmpZip = path.join(cacheDir, "archgate-download.zip");
    const tmpExtract = path.join(cacheDir, "archgate-extract");
    fs.writeFileSync(tmpZip, Buffer.concat(chunks));
    try {
      fs.mkdirSync(tmpExtract, { recursive: true });
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${tmpExtract}' -Force"`,
        { stdio: "pipe" }
      );
      const extractedBinary = path.join(tmpExtract, binaryName);
      if (!fs.existsSync(extractedBinary)) {
        throw new Error(`Binary ${binaryName} not found in zip archive`);
      }
      fs.copyFileSync(extractedBinary, destPath);
    } finally {
      try { fs.unlinkSync(tmpZip); } catch { /* cleanup */ }
      try { fs.rmSync(tmpExtract, { recursive: true, force: true }); } catch { /* cleanup */ }
    }
  } else {
    // Download tar.gz, extract binary using inline tar parser
    const res = await fetchWithRedirects(url);
    await new Promise((resolve, reject) => {
      const gunzip = zlib.createGunzip();
      const chunks = [];

      res.pipe(gunzip);
      gunzip.on("data", (chunk) => chunks.push(chunk));
      gunzip.on("end", () => {
        const data = Buffer.concat(chunks);
        let offset = 0;
        let found = false;

        while (offset + 512 <= data.length) {
          const header = data.subarray(offset, offset + 512);
          offset += 512;

          if (header.every((b) => b === 0)) break;

          let name = stripNulls(header.subarray(0, 100).toString("utf8"));
          const prefix = stripNulls(
            header.subarray(345, 500).toString("utf8")
          );
          if (prefix) name = `${prefix}/${name}`;

          const sizeStr = stripNulls(
            header.subarray(124, 136).toString("utf8")
          ).trim();
          const size = parseInt(sizeStr, 8) || 0;
          const blocks = Math.ceil(size / 512);
          const fileData = data.subarray(offset, offset + size);
          offset += blocks * 512;

          if (name === binaryName || name.endsWith(`/${binaryName}`)) {
            fs.writeFileSync(destPath, fileData, { mode: 0o755 });
            found = true;
            break;
          }
        }

        if (found) {
          resolve();
        } else {
          reject(
            new Error(`Could not find ${binaryName} in archive from ${url}`)
          );
        }
      });

      gunzip.on("error", reject);
    });
  }

  console.error(`archgate: binary downloaded successfully.`);
  return destPath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let binary = getBinaryPath();

  // If the binary is missing, download it on-demand from GitHub Releases.
  if (!binary) {
    try {
      binary = await downloadBinary();
    } catch (err) {
      console.error(
        `archgate: failed to download binary: ${err.message}\n` +
          `Visit https://cli.archgate.dev/getting-started/installation/ for alternative install methods.`
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
