#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
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

function getBinaryPath() {
  const pkgName = getPlatformPackageName();
  const binaryName = process.platform === "win32" ? "archgate.exe" : "archgate";
  try {
    const pkgDir = path.dirname(require.resolve(`${pkgName}/package.json`));
    const binaryPath = path.join(pkgDir, "bin", binaryName);
    if (fs.existsSync(binaryPath)) return binaryPath;
  } catch {
    /* platform package not installed */
  }
  throw new Error(
    `archgate binary not found. "${getPlatformPackageName()}" may not be installed.\nTry reinstalling: npm install -g archgate`
  );
}

try {
  const binary = getBinaryPath();
  execFileSync(binary, process.argv.slice(2), { stdio: "inherit" });
} catch (e) {
  if (typeof e.status === "number") process.exit(e.status);
  console.error(e.message);
  process.exit(2);
}
