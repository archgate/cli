// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/** Download and install the archgate plugin for supported editors. */

import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { logDebug } from "./log";
import { cursorUserDir, internalPath, opencodeAgentsDir } from "./paths";
import { resolveCommand } from "./platform";

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
// Cursor — download and extract into user-scope discovery dirs
// ---------------------------------------------------------------------------

/**
 * Install the archgate Cursor components into user-scope discovery dirs.
 *
 * Cursor discovers skills and agents from `~/.cursor/{skills,agents}/`.
 * The tarball from /api/cursor contains these at its root:
 *   - skills/archgate-{name}/SKILL.md — skill definitions
 *   - agents/archgate-{name}.md — agent definitions
 *   - hooks.json — afterFileEdit hook for archgate check
 *
 * Extraction uses `tar` via `Bun.spawn` — `tar` is available on macOS,
 * Linux, and modern Windows (bsdtar ships with Windows 10+).
 *
 * After extraction, `hooks.json` is merged into `~/.cursor/hooks.json`
 * (rather than extracted as-is) to avoid overwriting existing user hooks.
 *
 * Throws on download or extraction failure so callers can surface a manual
 * retry hint.
 */
export async function installCursorPlugin(token: string): Promise<void> {
  const tarballPath = internalPath("archgate-cursor.tar.gz");
  const cursorDir = cursorUserDir();

  const buffer = await downloadPluginAsset("/api/cursor", token);
  logDebug(
    `Downloaded Cursor install bundle (${Math.round(buffer.byteLength / 1024)} KB)`
  );
  await Bun.write(tarballPath, buffer);

  try {
    // Ensure target dirs exist — tar will write files, but it won't create
    // the enclosing `~/.cursor/{skills,agents}/` paths.
    mkdirSync(join(cursorDir, "skills"), { recursive: true });
    mkdirSync(join(cursorDir, "agents"), { recursive: true });

    logDebug(`Extracting Cursor components into ${cursorDir}`);
    const result = await run(["tar", "-xzf", tarballPath, "-C", cursorDir]);
    if (result.exitCode !== 0) {
      throw new Error(
        `tar -xzf failed (exit ${result.exitCode}) while extracting Cursor components`
      );
    }

    // Merge hooks.json into ~/.cursor/hooks.json instead of leaving the
    // extracted copy (which would be at ~/.cursor/hooks.json and would
    // overwrite existing user hooks). The tarball extracts it, so we
    // merge the archgate hooks into any existing hooks file.
    await mergeCursorHooks(cursorDir);
  } finally {
    try {
      unlinkSync(tarballPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Merge archgate hooks into `~/.cursor/hooks.json`.
 *
 * If the file already exists, reads it, removes any previous archgate hooks
 * (identified by the archgate check command), appends the new ones, and
 * writes back. If it doesn't exist, uses the extracted file as-is.
 */
async function mergeCursorHooks(cursorDir: string): Promise<void> {
  const hooksPath = join(cursorDir, "hooks.json");
  if (!existsSync(hooksPath)) return;

  try {
    const existing: { event: string; command?: string }[] = JSON.parse(
      await Bun.file(hooksPath).text()
    );

    // Remove any previous archgate hooks
    const filtered = existing.filter(
      (h) => !h.command?.includes("archgate check")
    );

    // Add our hooks
    const archgateHooks = [
      {
        event: "afterFileEdit",
        type: "command",
        command: "archgate check ${filePath} --json 2>/dev/null || true",
      },
    ];

    const merged = [...filtered, ...archgateHooks];
    await Bun.write(hooksPath, JSON.stringify(merged, null, 2) + "\n");
    logDebug("Merged archgate hooks into", hooksPath);
  } catch {
    // If existing hooks.json is malformed, leave it alone
    logDebug("Could not merge hooks.json — leaving existing file");
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

  // Configure opencode.json with default_agent (idempotent — only sets if absent)
  const { configureOpencodeSettings } = await import("./opencode-settings");
  await configureOpencodeSettings();
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
