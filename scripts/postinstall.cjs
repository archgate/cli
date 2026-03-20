#!/usr/bin/env node
"use strict";

// Best-effort pre-download: tries to fetch the binary during install so the
// first `archgate` invocation is instant. If this script is blocked by the
// package manager (--ignore-scripts, etc.), the bin shim will download
// on-demand at runtime instead.

const path = require("path");
const fs = require("fs");

const PACKAGE_NAME_MAP = {
  "darwin-arm64": "archgate-darwin-arm64",
  "linux-x64": "archgate-linux-x64",
  "win32-x64": "archgate-win32-x64",
};

function isBinaryPresent() {
  const key = `${process.platform}-${process.arch}`;
  const pkgName = PACKAGE_NAME_MAP[key];
  if (!pkgName) return true; // unsupported platform — skip silently

  const binaryName = process.platform === "win32" ? "archgate.exe" : "archgate";

  // Check optional dependency
  try {
    const pkgDir = path.dirname(require.resolve(`${pkgName}/package.json`));
    if (fs.existsSync(path.join(pkgDir, "bin", binaryName))) return true;
  } catch {
    /* not installed */
  }

  // Check local fallback
  if (fs.existsSync(path.join(__dirname, "..", "bin", binaryName))) return true;

  return false;
}

if (!isBinaryPresent()) {
  // Delegate to the bin shim's download logic by running it with --version.
  // This triggers the on-demand download without side effects.
  try {
    require("child_process").execFileSync(
      process.execPath,
      [path.join(__dirname, "..", "bin", "archgate.cjs"), "--version"],
      { stdio: "inherit" }
    );
  } catch {
    // Postinstall must never block `npm install`.
    console.warn(
      "archgate: could not pre-download binary. It will be downloaded on first run."
    );
  }
}
