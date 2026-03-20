import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

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
// Install method detection
// ---------------------------------------------------------------------------

type InstallMethod =
  | { type: "binary"; binaryPath: string }
  | { type: "proto"; protoCmd: string }
  | { type: "local"; cmd: string; args: string[]; manualHint: string }
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

function getProtoHome(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  return process.env.PROTO_HOME ?? join(home, ".proto");
}

function isProtoInstall(): boolean {
  const protoToolDir = join(getProtoHome(), "tools", "archgate");
  return process.execPath.startsWith(protoToolDir);
}

function isLocalInstall(): boolean {
  return process.execPath.includes("node_modules");
}

function findProjectRoot(): string | null {
  let dir = dirname(process.execPath);
  while (true) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const LOCKFILE_TO_PM: [string, string, string[]][] = [
  ["bun.lock", "bun", ["add", "-d", "archgate@latest"]],
  ["bun.lockb", "bun", ["add", "-d", "archgate@latest"]],
  ["pnpm-lock.yaml", "pnpm", ["add", "-D", "archgate@latest"]],
  ["yarn.lock", "yarn", ["add", "-D", "archgate@latest"]],
  ["package-lock.json", "npm", ["install", "-D", "archgate@latest"]],
];

async function detectLocalPm(): Promise<{
  cmd: string;
  args: string[];
  manualHint: string;
} | null> {
  const root = findProjectRoot();
  if (!root) return null;

  const match = LOCKFILE_TO_PM.find(([lockfile]) =>
    existsSync(join(root, lockfile))
  );
  if (!match) return null;

  const [, name, args] = match;
  const resolved = (await resolveCommand(name)) ?? name;
  return { cmd: resolved, args, manualHint: `${name} ${args.join(" ")}` };
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

  if (isProtoInstall()) {
    const protoCmd = (await resolveCommand("proto")) ?? "proto";
    return { type: "proto", protoCmd };
  }

  if (isLocalInstall()) {
    const local = await detectLocalPm();
    if (local) return { type: "local", ...local };
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
// Upgrade flows
// ---------------------------------------------------------------------------

async function upgradeBinary(tag: string): Promise<void> {
  const artifact = getArtifactInfo();
  if (!artifact) {
    logError(
      `Unsupported platform: ${getPlatformInfo().runtime}/${process.arch}`,
      "archgate supports darwin/arm64, linux/x64, and win32/x64."
    );
    process.exit(2);
  }

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
}

async function runExternalUpgrade(
  cmd: string[],
  manualHint: string
): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    logError(
      "Failed to install the latest version.",
      `Try running \`${manualHint}\` manually.`
    );
    process.exit(1);
  }
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

      const tag = await fetchLatestGitHubVersion();
      if (!tag) {
        logError(
          "Failed to fetch release info from GitHub.",
          "Check your network connection."
        );
        process.exit(1);
      }

      const packageJson = await import("../../package.json");
      const currentVersion = packageJson.default.version;
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

      const method = await detectInstallMethod();

      if (method.type === "binary") {
        await upgradeBinary(tag);
      } else if (method.type === "proto") {
        await runExternalUpgrade(
          [method.protoCmd, "install", "archgate", "latest", "--pin"],
          "proto install archgate latest --pin"
        );
      } else {
        await runExternalUpgrade(
          [method.cmd, ...method.args],
          method.manualHint
        );
      }

      console.log(`Archgate upgraded to ${latestVersion} successfully.`);
    });
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export {
  isBinaryInstall as _isBinaryInstall,
  isProtoInstall as _isProtoInstall,
  isLocalInstall as _isLocalInstall,
  detectInstallMethod as _detectInstallMethod,
};
