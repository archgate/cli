import type { Command } from "@commander-js/extra-typings";
import { semver } from "bun";

import { logError } from "../helpers/log";

const NPM_REGISTRY = "https://registry.npmjs.org/archgate/latest";

export function registerUpgradeCommand(program: Command) {
  program
    .command("upgrade")
    .description("Upgrade Archgate to the latest version via npm")
    .action(async () => {
      console.log("Checking for latest Archgate release...");

      let latestVersion: string;
      try {
        const response = await fetch(NPM_REGISTRY, {
          headers: { "User-Agent": "archgate-cli" },
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          logError(
            "Failed to fetch release info from npm registry.",
            `HTTP ${response.status}. Check your network connection.`
          );
          process.exit(1);
        }

        const data = (await response.json()) as { version?: string };
        if (!data.version) {
          logError("Could not parse version from npm registry response.");
          process.exit(2);
        }
        latestVersion = data.version;
      } catch {
        logError(
          "Failed to reach npm registry.",
          "Check your network connection and try again."
        );
        process.exit(1);
      }

      const packageJson = await import("../../package.json");
      const currentVersion = packageJson.default.version;
      const order = semver.order(currentVersion, latestVersion);

      if (order === null) {
        logError(
          `Could not compare versions: ${currentVersion} vs ${latestVersion}`
        );
        process.exit(2);
      }

      if (order >= 0) {
        console.log(`Archgate is already up-to-date (${currentVersion}).`);
        process.exit(0);
      }

      console.log(`Upgrading ${currentVersion} -> ${latestVersion}...`);

      const proc = Bun.spawn(["npm", "install", "-g", "archgate@latest"], {
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        logError(
          "Failed to install the latest version via npm.",
          "Try running `npm install -g archgate@latest` manually."
        );
        process.exit(1);
      }

      console.log(`Archgate upgraded to ${latestVersion} successfully.`);
    });
}
