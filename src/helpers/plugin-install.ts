/**
 * plugin-install.ts — Download and install the archgate plugin for supported editors.
 *
 * - Claude Code: auto-installs via `claude` CLI, or prints manual commands as fallback
 * - VS Code:     marketplace URL for manual user-settings configuration (application-scoped)
 * - Copilot CLI:  auto-installs via `copilot` CLI, or prints manual commands as fallback
 * - Cursor:      downloads cursor.tar.gz from the plugins service and extracts it
 */

import { mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import type { StoredCredentials } from "./auth";
import { logDebug } from "./log";
import { resolveCommand } from "./platform";

const PLUGINS_API = "https://plugins.archgate.dev";

/**
 * Run a command using Bun.spawn (cross-platform, no shell).
 * Returns { exitCode, stdout }.
 */
async function run(
  cmd: string[],
  opts?: { cwd?: string }
): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout };
}

// ---------------------------------------------------------------------------
// Claude Code — CLI auto-install + manual fallback
// ---------------------------------------------------------------------------

/**
 * Build the authenticated git marketplace URL for Claude Code & Copilot CLI plugin installation.
 * Claude Code and Copilot CLI both use the .claude-plugin/ manifest format.
 */
export function buildMarketplaceUrl(credentials: StoredCredentials): string {
  return `https://${credentials.github_user}:${credentials.token}@plugins.archgate.dev/archgate.git`;
}

/**
 * Build the authenticated git marketplace URL for VS Code plugin installation.
 * VS Code Copilot uses the .github/plugin/ manifest format, served from a separate repo.
 */
export function buildVscodeMarketplaceUrl(
  credentials: StoredCredentials
): string {
  return `https://${credentials.github_user}:${credentials.token}@plugins.archgate.dev/archgate-vscode.git`;
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
 * Install the archgate plugin via the `claude` CLI.
 *
 * Runs:
 *   claude plugin marketplace add <authenticated-url>
 *   claude plugin install archgate@archgate
 *
 * Throws on failure so the caller can fall back to manual instructions.
 */
export async function installClaudePlugin(
  credentials: StoredCredentials
): Promise<void> {
  const url = buildMarketplaceUrl(credentials);
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
// Cursor — download and extract plugin bundle
// ---------------------------------------------------------------------------

/**
 * Download the cursor.tar.gz from the plugins service and extract it to the project root.
 * Creates/overwrites .cursor/ folder contents with the pre-built agent and skills.
 */
export async function installCursorPlugin(
  projectRoot: string,
  token: string
): Promise<string[]> {
  const response = await fetch(`${PLUGINS_API}/api/cursor`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "archgate-cli" },
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 401) {
    throw new Error(
      "Plugin download unauthorized. Your token may have expired — run `archgate login refresh`."
    );
  }

  if (!response.ok) {
    throw new Error(
      `Plugin download failed (HTTP ${response.status}). Try again later.`
    );
  }

  const tarGzBuffer = await response.arrayBuffer();

  logDebug(
    `Downloaded cursor plugin archive (${Math.round(tarGzBuffer.byteLength / 1024)} KB)`
  );

  const extractedFiles = await extractTarGz(
    new Uint8Array(tarGzBuffer),
    projectRoot
  );

  return extractedFiles;
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
 *   copilot plugin install <authenticated-git-url>
 *
 * Throws on failure so the caller can fall back to manual instructions.
 */
export async function installCopilotPlugin(
  credentials: StoredCredentials
): Promise<void> {
  const url = buildMarketplaceUrl(credentials);
  const cmd = (await resolveCommand("copilot")) ?? "copilot";

  logDebug("Installing archgate plugin via copilot CLI");
  const installResult = await run([cmd, "plugin", "install", url]);
  if (installResult.exitCode !== 0) {
    throw new Error(
      `copilot plugin install failed (exit ${installResult.exitCode})`
    );
  }
}

// ---------------------------------------------------------------------------
// Shared — tar extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract a .tar.gz buffer to a destination directory.
 * Uses system tar (available on macOS, Linux, and Windows 10+).
 */
async function extractTarGz(
  data: Uint8Array,
  destDir: string
): Promise<string[]> {
  // Write the archive to a temporary file
  const tmpArchive = join(destDir, ".archgate-cursor-plugin.tar.gz");
  await Bun.write(tmpArchive, data);

  try {
    mkdirSync(destDir, { recursive: true });

    // Extract using tar (available on macOS, Linux, and Windows 10+)
    const result = await run(["tar", "-xzf", tmpArchive, "-C", destDir]);

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to extract plugin archive (tar exit code ${result.exitCode})`
      );
    }

    // List extracted files for reporting
    const listResult = await run(["tar", "-tzf", tmpArchive]);
    const files = listResult.stdout
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);

    return files;
  } finally {
    try {
      unlinkSync(tmpArchive);
    } catch {
      // Ignore cleanup errors
    }
  }
}
