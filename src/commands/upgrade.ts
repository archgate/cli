import type { Command } from "@commander-js/extra-typings";
import { semver } from "bun";
import { logError } from "../helpers/log";
import { resolveCommand } from "../helpers/platform";

const NPM_REGISTRY = "https://registry.npmjs.org/archgate/latest";

interface PackageManager {
  name: string;
  globalBinCmd: string[];
  upgradeArgs: string[];
}

const PACKAGE_MANAGERS: PackageManager[] = [
  {
    name: "bun",
    globalBinCmd: ["bun", "pm", "-g", "bin"],
    upgradeArgs: ["add", "-g", "archgate@latest"],
  },
  {
    name: "pnpm",
    globalBinCmd: ["pnpm", "bin", "-g"],
    upgradeArgs: ["add", "-g", "archgate@latest"],
  },
  {
    name: "yarn",
    globalBinCmd: ["yarn", "global", "bin"],
    upgradeArgs: ["global", "add", "archgate@latest"],
  },
  {
    name: "npm",
    globalBinCmd: ["npm", "bin", "-g"],
    upgradeArgs: ["install", "-g", "archgate@latest"],
  },
];

/**
 * Get the global bin directory for a package manager.
 * Returns null if the command is not available or fails.
 */
async function getGlobalBinDir(cmd: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Detect which package manager installed archgate by checking whether
 * the running binary lives under each manager's global bin directory.
 * Resolves all candidates in parallel. Falls back to npm if none match.
 */
async function detectPackageManager(): Promise<{
  cmd: string;
  args: string[];
  manualHint: string;
}> {
  const binaryPath = process.execPath;

  // Resolve all package managers in parallel
  const candidates = await Promise.all(
    PACKAGE_MANAGERS.map(async (pm) => {
      const resolved = await resolveCommand(pm.name);
      if (!resolved) return null;
      const globalBinCmd = [resolved, ...pm.globalBinCmd.slice(1)];
      const binDir = await getGlobalBinDir(globalBinCmd);
      return { pm, resolved, binDir };
    })
  );

  // Find which PM's global bin dir contains the running binary
  const match = candidates.find(
    (c) => c?.binDir && binaryPath.startsWith(c.binDir)
  );

  if (match) {
    return {
      cmd: match.resolved,
      args: match.pm.upgradeArgs,
      manualHint: `${match.pm.name} ${match.pm.upgradeArgs.join(" ")}`,
    };
  }

  // Default to npm
  const npmCandidate = candidates.find((c) => c?.pm.name === "npm");
  const npm = PACKAGE_MANAGERS.find((pm) => pm.name === "npm")!;
  return {
    cmd: npmCandidate?.resolved ?? "npm",
    args: npm.upgradeArgs,
    manualHint: `npm ${npm.upgradeArgs.join(" ")}`,
  };
}

export function registerUpgradeCommand(program: Command) {
  program
    .command("upgrade")
    .description("Upgrade Archgate to the latest version")
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

      const { cmd, args, manualHint } = await detectPackageManager();

      const proc = Bun.spawn([cmd, ...args], {
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        logError(
          "Failed to install the latest version.",
          `Try running \`${manualHint}\` manually.`
        );
        process.exit(1);
      }

      console.log(`Archgate upgraded to ${latestVersion} successfully.`);
    });
}
