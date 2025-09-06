import { semver } from "bun";
import { internalPath } from "./paths";
import { logDebug } from "./log";

const CACHE_FILE = "last-update-check";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RELEASES_API =
  "https://api.github.com/repos/archgate/cli/releases/latest";

interface GitHubRelease {
  tag_name: string;
}

/**
 * Checks GitHub for a newer Archgate release (at most once per 24h).
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
      const lastCheck = parseInt(raw.trim(), 10);
      if (!isNaN(lastCheck) && Date.now() - lastCheck < CACHE_TTL_MS) {
        logDebug("Update check skipped — checked recently");
        return null;
      }
    }

    logDebug("Checking for updates...");

    const response = await fetch(RELEASES_API, {
      headers: {
        "User-Agent": "archgate-cli",
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      logDebug("Update check failed — GitHub API returned", response.status);
      return null;
    }

    const release = (await response.json()) as GitHubRelease;
    const latestTag = release.tag_name?.replace(/^v/, "");

    if (!latestTag) {
      logDebug("Update check failed — could not parse tag_name");
      return null;
    }

    // Write new cache timestamp regardless of result
    await Bun.write(cacheFile, String(Date.now()));

    const order = semver.order(currentVersion, latestTag);
    if (order === null || order >= 0) {
      // current >= latest or unparseable
      logDebug("Already up-to-date:", currentVersion, ">=", latestTag);
      return null;
    }

    return `\nArchgate update available: ${currentVersion} -> ${latestTag}\nRun \`archgate upgrade\` to update.`;
  } catch (err) {
    logDebug("Update check error (non-fatal):", err);
    return null;
  }
}
