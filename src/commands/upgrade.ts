import type { Command } from "@commander-js/extra-typings";
import { $ } from "bun";
import { semver } from "bun";
import { logError, logInfo } from "../helpers/log";
import { internalPath } from "../helpers/paths";

const RELEASES_API =
  "https://api.github.com/repos/archgate/cli/releases/latest";

interface GitHubRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

function getBinaryName(): string | null {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin" && arch === "arm64") return "archgate-darwin-arm64";
  if (platform === "linux" && arch === "x64") return "archgate-linux-x64";
  return null;
}

export function registerUpgradeCommand(program: Command) {
  program
    .command("upgrade")
    .description("Upgrade Archgate to the latest binary release")
    .action(async () => {
      const binaryName = getBinaryName();
      if (binaryName === null) {
        logError(
          `Unsupported platform: ${process.platform}/${process.arch}.`,
          "Only darwin/arm64 and linux/x64 are supported."
        );
        process.exit(1);
      }

      console.log("Checking for latest Archgate release...");

      let release: GitHubRelease;
      try {
        const response = await fetch(RELEASES_API, {
          headers: {
            "User-Agent": "archgate-cli",
            Accept: "application/vnd.github+json",
          },
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          logError(
            "Failed to fetch release info from GitHub.",
            `HTTP ${response.status}. Check your network connection.`
          );
          process.exit(1);
        }

        release = (await response.json()) as GitHubRelease;
      } catch {
        logError(
          "Failed to reach GitHub API.",
          "Check your network connection and try again."
        );
        process.exit(1);
      }

      const latestTag = release.tag_name?.replace(/^v/, "");
      if (!latestTag) {
        logError("Could not parse release tag from GitHub response.");
        process.exit(2);
      }

      const packageJson = await import("../../package.json");
      const currentVersion = packageJson.default.version;
      const order = semver.order(currentVersion, latestTag);

      if (order === null) {
        logError(
          `Could not compare versions: ${currentVersion} vs ${latestTag}`
        );
        process.exit(2);
      }

      if (order >= 0) {
        console.log(`Archgate is already up-to-date (${currentVersion}).`);
        process.exit(0);
      }

      console.log(`Upgrading ${currentVersion} -> ${latestTag}...`);

      const asset = release.assets.find((a) => a.name === binaryName);
      if (!asset) {
        logError(
          `No binary asset found for ${binaryName} in release ${latestTag}.`,
          "The release may still be building. Try again in a few minutes."
        );
        process.exit(1);
      }

      const downloadUrl = asset.browser_download_url;
      console.log(`Downloading ${binaryName}...`);

      let binaryData: ArrayBuffer;
      try {
        const dlResponse = await fetch(downloadUrl, {
          headers: { "User-Agent": "archgate-cli" },
          signal: AbortSignal.timeout(120000),
        });

        if (!dlResponse.ok) {
          logError(
            "Failed to download binary.",
            `HTTP ${dlResponse.status} from ${downloadUrl}`
          );
          process.exit(1);
        }

        binaryData = await dlResponse.arrayBuffer();
      } catch {
        logError(
          "Failed to download binary.",
          "Check your network connection and try again."
        );
        process.exit(1);
      }

      const tmpPath = internalPath("archgate-new");
      await Bun.write(tmpPath, binaryData);

      await $`chmod +x ${tmpPath}`.quiet();

      const installPath = process.execPath;
      const moveResult = await $`mv ${tmpPath} ${installPath}`
        .nothrow()
        .quiet();

      if (moveResult.exitCode !== 0) {
        // Try with sudo if mv failed (permission denied)
        logInfo("Insufficient permissions. Attempting upgrade with sudo...");
        const sudoResult = await $`sudo mv ${tmpPath} ${installPath}`
          .nothrow()
          .quiet();

        if (sudoResult.exitCode !== 0) {
          logError(
            "Failed to replace binary.",
            `Could not move ${tmpPath} to ${installPath}. Try running with sudo.`
          );
          process.exit(1);
        }
      }

      console.log(`Archgate upgraded to ${latestTag} successfully.`);
    });
}
