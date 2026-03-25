#!/usr/bin/env node
"use strict";

// Best-effort pre-download: tries to fetch the binary during install so the
// first `archgate` invocation is instant. If this script is blocked by the
// package manager (--ignore-scripts, etc.), the bin shim will download
// on-demand at runtime instead.

const path = require("path");
const fs = require("fs");
const os = require("os");

function isBinaryPresent() {
  const binaryName = process.platform === "win32" ? "archgate.exe" : "archgate";
  const cachePath = path.join(os.homedir(), ".archgate", "bin", binaryName);
  return fs.existsSync(cachePath);
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
