// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/** Download and install the archgate plugin for supported editors. */

import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { logDebug } from "./log";
import { internalPath, opencodeAgentsDir } from "./paths";
import { isWindows, resolveCommand } from "./platform";

const PLUGINS_API = "https://plugins.archgate.dev";

/** Base marketplace URL — credentials are provided by the git credential manager. */
const MARKETPLACE_URL = "https://plugins.archgate.dev/archgate.git";
/** Base VS Code marketplace URL — credentials are provided by the git credential manager. */
const VSCODE_MARKETPLACE_URL =
  "https://plugins.archgate.dev/archgate/vscode.git";
/** Cursor Team Marketplace URL — credentials are provided by the git credential manager. */
const CURSOR_MARKETPLACE_URL =
  "https://plugins.archgate.dev/archgate/cursor.git";

/**
 * Run a command using Bun.spawn (cross-platform, no shell).
 * Returns { exitCode, stdout, stderr }.
 */
async function run(
  cmd: string[],
  opts?: { cwd?: string }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

// ---------------------------------------------------------------------------
// VSIX compatibility helpers
// ---------------------------------------------------------------------------

/**
 * Read Cursor's underlying VS Code engine version from its `product.json`.
 *
 * The path is derived from the resolved `cursor` binary:
 *   .../cursor/resources/app/bin/cursor[.cmd]
 *   → .../cursor/resources/app/product.json
 *
 * Returns null when the version cannot be determined (missing file, no
 * cursor on PATH, unexpected directory layout).
 */
export async function getCursorVscodeVersion(): Promise<string | null> {
  try {
    const cursorBin = await resolveCommand("cursor");
    if (!cursorBin) return null;

    // On Windows Bun.which returns the native path (e.g.
    // C:\Users\...\cursor\resources\app\bin\cursor.cmd).
    // On Unix it may return a symlink target or similar.
    // Navigate from bin/ up to the app directory.
    const binDir = dirname(cursorBin); // .../resources/app/bin
    const appDir = dirname(binDir); // .../resources/app
    const productPath = join(appDir, "product.json");

    if (!existsSync(productPath)) return null;

    const product = await Bun.file(productPath).json();
    if (typeof product.vscodeVersion === "string") {
      return product.vscodeVersion;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the `engines.vscode` field from a downloaded VSIX file.
 *
 * The VSIX is a ZIP containing `extension/package.json`. We extract just
 * that entry using platform tools (PowerShell on Windows, unzip on Unix).
 *
 * Returns the raw `engines.vscode` string (e.g. "^1.96.0") or null if
 * the field cannot be read.
 */
async function readVsixEngineVersion(vsixPath: string): Promise<string | null> {
  try {
    const cmd = isWindows()
      ? buildPowershellZipReadCmd(vsixPath)
      : ["unzip", "-p", vsixPath, "extension/package.json"];

    const { stdout } = await run(cmd);
    if (!stdout.trim()) return null;
    const pkg = JSON.parse(stdout) as { engines?: { vscode?: string } };
    return pkg.engines?.vscode ?? null;
  } catch {
    return null;
  }
}

/** Build a PowerShell command to read a single entry from a ZIP file. */
function buildPowershellZipReadCmd(vsixPath: string): string[] {
  const script = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
    `$z=[System.IO.Compression.ZipFile]::OpenRead('${vsixPath}');`,
    "try{",
    "$e=$z.Entries|Where-Object{$_.FullName -eq 'extension/package.json'};",
    "if($e){$r=New-Object System.IO.StreamReader($e.Open());$r.ReadToEnd();$r.Close()}",
    "}finally{$z.Dispose()}",
  ].join("");
  return ["powershell", "-NoProfile", "-Command", script];
}

// ---------------------------------------------------------------------------
// Claude Code — CLI auto-install + manual fallback
// ---------------------------------------------------------------------------

/**
 * Get the marketplace URL for Claude Code & Copilot CLI plugin installation.
 * Credentials are provided by the git credential manager (no tokens in URLs).
 */
export function buildMarketplaceUrl(): string {
  return MARKETPLACE_URL;
}

/**
 * Get the marketplace URL for VS Code plugin installation.
 * Credentials are provided by the git credential manager (no tokens in URLs).
 */
export function buildVscodeMarketplaceUrl(): string {
  return VSCODE_MARKETPLACE_URL;
}

/**
 * Get the Cursor Team Marketplace URL for plugin installation.
 * Credentials are provided by the git credential manager (no tokens in URLs).
 */
export function buildCursorMarketplaceUrl(): string {
  return CURSOR_MARKETPLACE_URL;
}

/**
 * Check whether the `claude` CLI is available on the system PATH.
 * On WSL, also checks for `claude.exe` (Windows-side installation).
 */
export async function isClaudeCliAvailable(): Promise<boolean> {
  const resolved = await resolveCommand("claude");
  return resolved !== null;
}

/**
 * Check whether the `cursor` CLI is available on the system PATH.
 */
export async function isCursorCliAvailable(): Promise<boolean> {
  const resolved = await resolveCommand("cursor");
  return resolved !== null;
}

/**
 * Install the archgate plugin via the `claude` CLI.
 *
 * Runs:
 *   claude plugin marketplace add <authenticated-url>
 *   claude plugin install archgate@archgate
 *
 * Throws on failure so the caller can fall back to manual instructions.
 */
export async function installClaudePlugin(): Promise<void> {
  const url = buildMarketplaceUrl();
  const cmd = (await resolveCommand("claude")) ?? "claude";

  logDebug("Adding archgate marketplace to claude CLI");
  const addResult = await run([cmd, "plugin", "marketplace", "add", url]);
  if (addResult.exitCode !== 0) {
    throw new Error(
      `claude plugin marketplace add failed (exit ${addResult.exitCode})`
    );
  }

  logDebug("Installing archgate plugin via claude CLI");
  const installResult = await run([
    cmd,
    "plugin",
    "install",
    "archgate@archgate",
  ]);
  if (installResult.exitCode !== 0) {
    throw new Error(
      `claude plugin install failed (exit ${installResult.exitCode})`
    );
  }
}

// ---------------------------------------------------------------------------
// Shared — authenticated asset download
// ---------------------------------------------------------------------------

/** Download a plugin asset from the plugins API with Bearer auth. */
async function downloadPluginAsset(
  path: string,
  token: string
): Promise<ArrayBuffer> {
  const response = await fetch(`${PLUGINS_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "archgate-cli" },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });

  if (response.status === 401) {
    throw new Error(
      "Download unauthorized. Your token may have expired — run `archgate login refresh`."
    );
  }
  if (!response.ok) {
    throw new Error(
      `Download failed (HTTP ${response.status}). Try again later.`
    );
  }

  return response.arrayBuffer();
}

// ---------------------------------------------------------------------------
// Cursor — download .vsix and install via `cursor` CLI
// ---------------------------------------------------------------------------

/**
 * Download the archgate VSIX to `~/.archgate/archgate.vsix` without
 * installing it. Returns the absolute path to the saved file. Used when
 * the `cursor` CLI is not available so the user can install manually.
 */
export async function downloadVsix(token: string): Promise<string> {
  const vsixPath = internalPath("archgate.vsix");
  const buffer = await downloadPluginAsset("/api/vscode", token);
  logDebug(
    `Downloaded VS Code extension (${Math.round(buffer.byteLength / 1024)} KB)`
  );
  await Bun.write(vsixPath, buffer);
  return vsixPath;
}

/**
 * Install the archgate VS Code extension in Cursor via `cursor --install-extension`.
 *
 * On success the downloaded VSIX is cleaned up. On failure the VSIX is
 * kept at `~/.archgate/archgate.vsix` so the user can install it manually
 * via Cursor's "Extensions: Install from VSIX..." command.
 */
export async function installCursorPlugin(token: string): Promise<void> {
  const vsixPath = internalPath("archgate.vsix");
  const buffer = await downloadPluginAsset("/api/vscode", token);
  logDebug(
    `Downloaded VS Code extension (${Math.round(buffer.byteLength / 1024)} KB)`
  );
  await Bun.write(vsixPath, buffer);

  // --- Pre-flight compatibility check ---
  // Cursor is a VS Code fork pinned to a specific engine version.
  // If the VSIX targets a newer engine, `cursor --install-extension` will
  // reject it. Detect this upfront so we skip the noisy failed attempt.
  const cursorVscode = await getCursorVscodeVersion();
  const requiredVscode = await readVsixEngineVersion(vsixPath);
  logDebug("Cursor VS Code version:", cursorVscode ?? "unknown");
  logDebug("VSIX engines.vscode:", requiredVscode ?? "unknown");

  if (
    cursorVscode &&
    requiredVscode &&
    !Bun.semver.satisfies(cursorVscode, requiredVscode)
  ) {
    // Clean up the VSIX — it can't be installed in this Cursor version
    try {
      unlinkSync(vsixPath);
    } catch {
      // Ignore cleanup errors
    }
    throw new Error(
      `The archgate extension requires VS Code ${requiredVscode} but ` +
        `Cursor is based on VS Code ${cursorVscode}. ` +
        `Update Cursor or wait for a compatible extension release.`
    );
  }

  const cursorCmd = (await resolveCommand("cursor")) ?? "cursor";
  logDebug("Installing VS Code extension in Cursor via cursor CLI");
  const result = await run([cursorCmd, "--install-extension", vsixPath]);
  if (result.exitCode !== 0) {
    // Keep the VSIX on disk so the user can install it manually.
    // Include stderr detail so the user knows why the install failed.
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(
      `cursor --install-extension failed (exit ${result.exitCode}).` +
        (detail ? ` ${detail}.` : "") +
        ` The VSIX was saved to ${vsixPath} — install it manually in Cursor: ` +
        `Ctrl+Shift+P → "Extensions: Install from VSIX..."`
    );
  }

  // Clean up only on success
  try {
    unlinkSync(vsixPath);
  } catch {
    // Ignore cleanup errors
  }
}

// ---------------------------------------------------------------------------
// opencode — download agent bundle into user-scope agents dir
// ---------------------------------------------------------------------------

/**
 * Check whether the `opencode` CLI is available on the system PATH.
 * On WSL, also checks for `opencode.exe` (Windows-side installation).
 */
export async function isOpencodeCliAvailable(): Promise<boolean> {
  const resolved = await resolveCommand("opencode");
  return resolved !== null;
}

/**
 * Install the archgate opencode agents into the user-scope agents directory.
 *
 * Opencode has no plugin marketplace — agents are plain markdown files.
 * Archgate ships them as an authenticated tarball at `/api/opencode`. The
 * tarball contains `archgate-*.md` files at its root which extract directly
 * into the resolved `opencodeAgentsDir()`.
 *
 * The extraction uses `tar` via `Bun.spawn` (ARCH-007) — `tar` is available
 * on macOS, Linux, and modern Windows (bsdtar ships with Windows 10+).
 *
 * Throws on download or extraction failure so callers can surface a manual
 * retry hint.
 */
export async function installOpencodePlugin(token: string): Promise<void> {
  const tarballPath = internalPath("archgate-opencode.tar.gz");
  const agentsDir = opencodeAgentsDir();

  const buffer = await downloadPluginAsset("/api/opencode", token);
  logDebug(
    `Downloaded opencode agent bundle (${Math.round(buffer.byteLength / 1024)} KB)`
  );
  await Bun.write(tarballPath, buffer);

  try {
    // Ensure target dir exists — tar will write files, but it won't create
    // the enclosing `<config>/opencode/agents/` path.
    mkdirSync(agentsDir, { recursive: true });

    logDebug(`Extracting opencode agents into ${agentsDir}`);
    const result = await run(["tar", "-xzf", tarballPath, "-C", agentsDir]);
    if (result.exitCode !== 0) {
      throw new Error(
        `tar -xzf failed (exit ${result.exitCode}) while extracting opencode agents`
      );
    }
  } finally {
    try {
      unlinkSync(tarballPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ---------------------------------------------------------------------------
// Copilot CLI — CLI auto-install + manual fallback
// ---------------------------------------------------------------------------

/**
 * Check whether the `copilot` CLI is available on the system PATH.
 * On WSL, also checks for `copilot.exe` (Windows-side installation).
 */
export async function isCopilotCliAvailable(): Promise<boolean> {
  const resolved = await resolveCommand("copilot");
  return resolved !== null;
}

/**
 * Install the archgate plugin via the `copilot` CLI.
 *
 * Runs:
 *   copilot plugin marketplace add <vscode-marketplace-url>
 *   copilot plugin install archgate@archgate
 *
 * Throws on failure so the caller can fall back to manual instructions.
 */
export async function installCopilotPlugin(): Promise<void> {
  const url = buildVscodeMarketplaceUrl();
  const cmd = (await resolveCommand("copilot")) ?? "copilot";

  logDebug("Adding archgate marketplace to copilot CLI");
  const addResult = await run([cmd, "plugin", "marketplace", "add", url]);
  if (addResult.exitCode !== 0) {
    // "already registered" is not an error — the marketplace was added in a
    // previous run. Skip and proceed to install.
    const combined = addResult.stdout + addResult.stderr;
    if (!combined.includes("already registered")) {
      const detail = combined.trim();
      throw new Error(
        `copilot plugin marketplace add failed (exit ${addResult.exitCode})` +
          (detail ? `\n${detail}` : "")
      );
    }
    logDebug("Marketplace already registered, skipping add");
  }

  logDebug("Installing archgate plugin via copilot CLI");
  const installResult = await run([
    cmd,
    "plugin",
    "install",
    "archgate@archgate",
  ]);
  if (installResult.exitCode !== 0) {
    throw new Error(
      `copilot plugin install failed (exit ${installResult.exitCode})`
    );
  }
}

// ---------------------------------------------------------------------------
// VS Code — download .vsix and install via `code` CLI
// ---------------------------------------------------------------------------

/**
 * Check whether the `code` CLI is available on the system PATH.
 * On WSL, also checks for `code.exe` (Windows-side installation).
 */
export async function isVscodeCliAvailable(): Promise<boolean> {
  const resolved = await resolveCommand("code");
  return resolved !== null;
}

/**
 * Download the .vsix from the plugins service and install via `code` CLI.
 *
 * On success the downloaded VSIX is cleaned up. On failure the VSIX is
 * kept at `~/.archgate/archgate.vsix` so the user can install it manually.
 */
export async function installVscodeExtension(token: string): Promise<void> {
  const vsixPath = internalPath("archgate.vsix");
  const buffer = await downloadPluginAsset("/api/vscode", token);
  logDebug(
    `Downloaded VS Code extension (${Math.round(buffer.byteLength / 1024)} KB)`
  );
  await Bun.write(vsixPath, buffer);

  const codeCmd = (await resolveCommand("code")) ?? "code";
  logDebug("Installing VS Code extension via code CLI");
  const result = await run([codeCmd, "--install-extension", vsixPath]);
  if (result.exitCode !== 0) {
    // Keep the VSIX on disk so the user can install it manually
    throw new Error(
      `code --install-extension failed (exit ${result.exitCode}). ` +
        `The VSIX was saved to ${vsixPath} — install it manually: ` +
        `code --install-extension "${vsixPath}"`
    );
  }

  // Clean up only on success
  try {
    unlinkSync(vsixPath);
  } catch {
    // Ignore cleanup errors
  }
}
