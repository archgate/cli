// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { semver } from "bun";

import { fetchLatestGitHubVersion } from "./binary-upgrade";
import { logDebug } from "./log";
import { internalPath } from "./paths";

const CACHE_FILE = "last-update-check";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Only check for updates in a genuine interactive terminal — never during
 * `upgrade`, in CI, or when stdout is piped (avoids polluting parsed output).
 */
export function shouldPerformUpdateCheck(opts: {
  argv: string[];
  isTTY: boolean;
  ci: boolean;
}): boolean {
  const isUpgrade = opts.argv.includes("upgrade");
  return !isUpgrade && opts.isTTY && !opts.ci;
}

/**
 * Checks GitHub Releases for a newer Archgate release (at most once per 24h).
 * Returns a human-readable notice string if an update is available, or null otherwise.
 * All errors are swallowed — this is non-fatal and runs in the background.
 */
export async function checkForUpdatesIfNeeded(
  currentVersion: string
): Promise<string | null> {
  try {
    const cacheFile = internalPath(CACHE_FILE);

    // Read the cache file — contains the timestamp of the last check
    const cacheEntry = Bun.file(cacheFile);
    const cacheExists = await cacheEntry.exists();

    if (cacheExists) {
      const raw = await cacheEntry.text();
      const lastCheck = Math.trunc(Number(raw.trim()));
      if (!isNaN(lastCheck) && Date.now() - lastCheck < CACHE_TTL_MS) {
        logDebug("Update check skipped — checked recently");
        return null;
      }
    }

    logDebug("Checking for updates...");

    // Use a tight 5s timeout for the opportunistic background check so a
    // slow network never extends exit time. The full 15s default is
    // reserved for the explicit `archgate upgrade` path.
    const tag = await fetchLatestGitHubVersion(5_000);
    if (!tag) {
      logDebug("Update check failed — could not fetch latest GitHub release");
      return null;
    }

    const latestVersion = tag.replace(/^v/u, "");

    // Write new cache timestamp regardless of result
    await Bun.write(cacheFile, String(Date.now()));

    const order = semver.order(currentVersion, latestVersion);
    if (order === null || order >= 0) {
      // current >= latest or unparseable
      logDebug("Already up-to-date:", currentVersion, ">=", latestVersion);
      return null;
    }

    return `\nArchgate update available: ${currentVersion} -> ${latestVersion}\nRun \`archgate upgrade\` to update.`;
  } catch (err) {
    logDebug("Update check error (non-fatal):", err);
    return null;
  }
}

/**
 * Starts the background update check for this invocation, gated by
 * shouldPerformUpdateCheck(). Resolves to a notice string, or null if the
 * check didn't run or found nothing.
 */
export function maybeCheckForUpdates(
  currentVersion: string
): Promise<string | null> {
  const shouldCheck = shouldPerformUpdateCheck({
    argv: process.argv,
    isTTY: process.stdout.isTTY === true,
    ci: Boolean(Bun.env.CI),
  });
  return shouldCheck
    ? checkForUpdatesIfNeeded(currentVersion)
    : Promise.resolve(null);
}
