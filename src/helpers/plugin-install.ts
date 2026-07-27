// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/** Download and install the archgate plugin for supported editors. */

import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { logDebug } from "./log";
import { cursorUserDir, internalPath, opencodeConfigDir } from "./paths";
import { resolveCommand } from "./platform";
import { UserError } from "./user-error";

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
 * Run a command using `Bun.spawn` (cross-platform, no shell — ARCH-007).
 *
 * @param cmd - Argv array, the executable first.
 * @param opts - `cwd` sets the working directory for the child process.
 * @returns The exit code plus captured `stdout` and `stderr`.
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
    throw new UserError(
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
    throw new UserError(
      `claude plugin install failed (exit ${installResult.exitCode})`
    );
  }
}

// ---------------------------------------------------------------------------
// Cursor — download and extract into user-scope discovery dirs
// ---------------------------------------------------------------------------

/**
 * Install the archgate Cursor components into user-scope discovery dirs
 * (`~/.cursor/{skills,agents}/`). The /api/cursor tarball root holds
 * per-skill SKILL.md directories, agent markdown files, and a `hooks.json`
 * that is merged into `~/.cursor/hooks.json` to preserve existing user hooks.
 * Throws on download or extraction failure so callers can surface a retry hint.
 */
export async function installCursorPlugin(token: string): Promise<void> {
  const cursorDir = cursorUserDir();

  await installEditorPluginBundle({
    baseDir: cursorDir,
    apiPath: "/api/cursor",
    token,
    label: "Cursor",
    tempFile: "archgate-cursor.tar.gz",
  });

  await mergeCursorHooks(cursorDir);
}

/** Shape-check only; validated values are used as-is, so extra per-entry
 * fields (e.g. `type`) survive the round-trip through {@link mergeCursorHooks}
 * unchanged. */
const cursorHookArraySchema = z.array(
  z.object({ event: z.string(), command: z.string().optional() })
);

/** Narrow an untyped JSON value to a hooks.json entry array. */
function isCursorHookArray(
  value: unknown
): value is { event: string; command?: string }[] {
  return cursorHookArraySchema.safeParse(value).success;
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
    const parsed: unknown = await Bun.file(hooksPath).json();
    if (!isCursorHookArray(parsed)) {
      throw new Error("hooks.json has an unexpected shape");
    }
    const existing = parsed;

    const filtered = existing.filter(
      (h) => h.command === undefined || !h.command.includes("archgate check")
    );

    const archgateHooks = [
      {
        event: "afterFileEdit",
        type: "command",
        command: "archgate check ${filePath} --json 2>/dev/null || true",
      },
    ];

    for (const h of archgateHooks) filtered.push(h);
    await Bun.write(hooksPath, JSON.stringify(filtered, null, 2) + "\n");
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
    throw new UserError(
      "Download unauthorized. Your token may have expired — run `archgate login refresh`."
    );
  }
  if (!response.ok) {
    throw new UserError(
      `Download failed (HTTP ${response.status}). Try again later.`
    );
  }

  return response.arrayBuffer();
}

// ---------------------------------------------------------------------------
// Shared — editor plugin bundle install (agents + skills)
// ---------------------------------------------------------------------------

/**
 * Install an archgate editor plugin bundle (agents + skills), shared by
 * Cursor and opencode: ensure `agents/`/`skills/` exist, delete stale
 * `archgate-*` entries (only those — other files stay untouched), then
 * download and extract the authenticated tarball with `tar` via ARCH-007's
 * `run()`. Editor-specific post-install steps happen in each caller.
 */
async function installEditorPluginBundle(opts: {
  baseDir: string;
  apiPath: string;
  token: string;
  label: string;
  tempFile: string;
}): Promise<void> {
  const agentsDir = join(opts.baseDir, "agents");
  const skillsDir = join(opts.baseDir, "skills");
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });

  // Clean old archgate agents (flat .md files)
  for (const file of new Bun.Glob("archgate-*.md").scanSync({
    cwd: agentsDir,
    dot: true,
  })) {
    unlinkSync(join(agentsDir, file));
  }

  // Clean old archgate skill directories (archgate-*/SKILL.md)
  const staleSkillDirs = new Set(
    Array.from(
      new Bun.Glob("archgate-*/*").scanSync({ cwd: skillsDir, dot: true }),
      (f) => f.split(/[/\\]/u)[0]
    )
  );
  for (const dir of staleSkillDirs) {
    rmSync(join(skillsDir, dir), { recursive: true, force: true });
  }

  const tarballPath = internalPath(opts.tempFile);
  const buffer = await downloadPluginAsset(opts.apiPath, opts.token);
  logDebug(
    `Downloaded ${opts.label} bundle (${Math.round(buffer.byteLength / 1024)} KB)`
  );
  await Bun.write(tarballPath, buffer);

  try {
    logDebug(`Extracting ${opts.label} components into ${opts.baseDir}`);
    const result = await run(["tar", "-xzf", tarballPath, "-C", opts.baseDir]);
    if (result.exitCode !== 0) {
      throw new UserError(
        `tar -xzf failed (exit ${result.exitCode}) while extracting ${opts.label} components`
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
// opencode — download plugin bundle into user-scope config dir
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
 * Check whether opencode is installed in any form — the CLI on PATH, or the
 * Desktop app (Electron GUI, no CLI binary). Both distributions share
 * `opencodeConfigDir()`, so that directory existing is reliable evidence of
 * an opencode install even when the CLI probe finds nothing. Call sites use
 * this to gate the plugin install, which only writes files into that dir.
 */
export async function isOpencodeAvailable(): Promise<boolean> {
  if (await isOpencodeCliAvailable()) return true;
  return existsSync(opencodeConfigDir());
}

/**
 * Install archgate agents and skills into opencode's user-scope directories.
 * Opencode has no plugin marketplace — the `/api/opencode` tarball ships
 * plain-markdown `agents/` and `skills/` directories that extract into
 * `opencodeConfigDir()`. Throws on download or extraction failure so
 * callers can surface a manual retry hint.
 */
export async function installOpencodePlugin(token: string): Promise<void> {
  const baseDir = opencodeConfigDir();

  await installEditorPluginBundle({
    baseDir,
    apiPath: "/api/opencode",
    token,
    label: "opencode",
    tempFile: "archgate-opencode.tar.gz",
  });

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
      throw new UserError(
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
    throw new UserError(
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
    throw new UserError(
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
