/**
 * plugin-install.ts — Download and install the archgate plugin for supported editors.
 *
 * - Claude Code: generates the marketplace URL (plugin installed via Claude Code slash commands)
 * - Cursor:      downloads cursor.tar.gz from the plugins service and extracts it
 */

import { join } from "node:path";
import { mkdirSync, unlinkSync } from "node:fs";
import { $ } from "bun";
import { logDebug } from "./log";
import type { StoredCredentials } from "./auth";

const PLUGINS_API = "https://plugins.archgate.dev";

// ---------------------------------------------------------------------------
// Claude Code — marketplace URL generation
// ---------------------------------------------------------------------------

/**
 * Build the authenticated git marketplace URL for Claude Code plugin installation.
 */
export function buildMarketplaceUrl(credentials: StoredCredentials): string {
  return `https://${credentials.github_user}:${credentials.token}@plugins.archgate.dev/archgate.git`;
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
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "archgate-cli",
    },
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
    const result = await $`tar -xzf ${tmpArchive} -C ${destDir}`.nothrow();

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to extract plugin archive (tar exit code ${result.exitCode})`
      );
    }

    // List extracted files for reporting
    const listResult = await $`tar -tzf ${tmpArchive}`.nothrow().text();
    const files = listResult
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
