import type { Command } from "@commander-js/extra-typings";
import { semver } from "bun";

import {
  downloadReleaseBinary,
  fetchLatestGitHubVersion,
  getArtifactInfo,
  getManualInstallHint,
  replaceBinary,
} from "../helpers/binary-upgrade";
import { logError } from "../helpers/log";
import { internalPath } from "../helpers/paths";
import { getPlatformInfo, resolveCommand } from "../helpers/platform";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NPM_REGISTRY = "https://registry.npmjs.org/archgate/latest";

// ---------------------------------------------------------------------------
// Install method detection
// ---------------------------------------------------------------------------

type InstallMethod =
  | { type: "binary"; binaryPath: string }
  | {
      type: "package-manager";
      cmd: string;
      args: string[];
      manualHint: string;
    };

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

function isBinaryInstall(): boolean {
  const binDir = internalPath("bin");
  return process.execPath.startsWith(binDir);
}

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

async function detectInstallMethod(): Promise<InstallMethod> {
  if (isBinaryInstall()) {
    return { type: "binary", binaryPath: process.execPath };
  }

  const binaryPath = process.execPath;

  const candidates = await Promise.all(
    PACKAGE_MANAGERS.map(async (pm) => {
      const resolved = await resolveCommand(pm.name);
      if (!resolved) return null;
      const globalBinCmd = [resolved, ...pm.globalBinCmd.slice(1)];
      const binDir = await getGlobalBinDir(globalBinCmd);
      return { pm, resolved, binDir };
    })
  );

  const match = candidates.find(
    (c) => c?.binDir && binaryPath.startsWith(c.binDir)
  );

  if (match) {
    return {
      type: "package-manager",
      cmd: match.resolved,
      args: match.pm.upgradeArgs,
      manualHint: `${match.pm.name} ${match.pm.upgradeArgs.join(" ")}`,
    };
  }

  const npmCandidate = candidates.find((c) => c?.pm.name === "npm");
  const npm = PACKAGE_MANAGERS.find((pm) => pm.name === "npm")!;
  return {
    type: "package-manager",
    cmd: npmCandidate?.resolved ?? "npm",
    args: npm.upgradeArgs,
    manualHint: `npm ${npm.upgradeArgs.join(" ")}`,
  };
}

// ---------------------------------------------------------------------------
// Version fetching (npm)
// ---------------------------------------------------------------------------

async function fetchLatestNpmVersion(): Promise<string | null> {
  const response = await fetch(NPM_REGISTRY, {
    headers: { "User-Agent": "archgate-cli" },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    logError(
      "Failed to fetch release info from npm registry.",
      `HTTP ${response.status}. Check your network connection.`
    );
    return null;
  }

  const data = (await response.json()) as { version?: string };
  return data.version ?? null;
}

// ---------------------------------------------------------------------------
// Upgrade flows
// ---------------------------------------------------------------------------

async function upgradeBinaryInstall(currentVersion: string): Promise<void> {
  const artifact = getArtifactInfo();
  if (!artifact) {
    logError(
      `Unsupported platform: ${getPlatformInfo().runtime}/${process.arch}`,
      "archgate supports darwin/arm64, linux/x64, and win32/x64."
    );
    process.exit(2);
  }

  const tag = await fetchLatestGitHubVersion();
  if (!tag) {
    logError(
      "Failed to fetch release info from GitHub.",
      "Check your network connection."
    );
    process.exit(1);
  }

  const latestVersion = tag.replace(/^v/, "");
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

  const hint = getManualInstallHint();
  let newBinaryPath: string;
  try {
    newBinaryPath = await downloadReleaseBinary(tag, artifact);
  } catch (err) {
    logError(
      "Failed to download the latest release.",
      `${err instanceof Error ? err.message : String(err)}\nTry running \`${hint}\` manually.`
    );
    process.exit(1);
  }

  try {
    replaceBinary(process.execPath, newBinaryPath);
  } catch (err) {
    logError(
      "Failed to replace the binary.",
      `${err instanceof Error ? err.message : String(err)}\nTry running \`${hint}\` manually.`
    );
    process.exit(1);
  }

  console.log(`Archgate upgraded to ${latestVersion} successfully.`);
}

async function upgradePackageManager(
  currentVersion: string,
  method: Extract<InstallMethod, { type: "package-manager" }>
): Promise<void> {
  const latestVersion = await fetchLatestNpmVersion();
  if (!latestVersion) {
    process.exit(1);
  }

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

  const proc = Bun.spawn([method.cmd, ...method.args], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    logError(
      "Failed to install the latest version.",
      `Try running \`${method.manualHint}\` manually.`
    );
    process.exit(1);
  }

  console.log(`Archgate upgraded to ${latestVersion} successfully.`);
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerUpgradeCommand(program: Command) {
  program
    .command("upgrade")
    .description("Upgrade Archgate to the latest version")
    .action(async () => {
      console.log("Checking for latest Archgate release...");

      const packageJson = await import("../../package.json");
      const currentVersion = packageJson.default.version;

      const method = await detectInstallMethod();

      if (method.type === "binary") {
        await upgradeBinaryInstall(currentVersion);
      } else {
        await upgradePackageManager(currentVersion, method);
      }
    });
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export {
  isBinaryInstall as _isBinaryInstall,
  detectInstallMethod as _detectInstallMethod,
};
