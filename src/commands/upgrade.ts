import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { clearLine, cursorTo } from "node:readline";

import type { Command } from "@commander-js/extra-typings";
import { semver } from "bun";

import {
  type DownloadProgressCallback,
  downloadReleaseBinary,
  fetchLatestGitHubVersion,
  getArtifactInfo,
  getManualInstallHint,
  replaceBinary,
} from "../helpers/binary-upgrade";
import { exitWith } from "../helpers/exit";
import { logDebug, logError } from "../helpers/log";
import { internalPath } from "../helpers/paths";
import { getPlatformInfo, resolveCommand } from "../helpers/platform";
import { trackUpgradeResult } from "../helpers/telemetry";

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
  return process.execPath.startsWith(internalPath("bin"));
}

function getProtoHome(): string {
  return (
    Bun.env.PROTO_HOME ??
    join(Bun.env.HOME ?? Bun.env.USERPROFILE ?? "~", ".proto")
  );
}

function isProtoInstall(): boolean {
  return process.execPath.startsWith(join(getProtoHome(), "tools", "archgate"));
}

function isLocalInstall(): boolean {
  return process.execPath.includes("node_modules");
}

/** Walk up from the binary location to find the nearest package.json (for local installs). */
function findPackageRoot(): string | null {
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
  const root = findPackageRoot();
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
    logDebug("Getting global bin dir:", cmd.join(" "));
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      logDebug("Global bin dir command failed, exit code:", exitCode);
      return null;
    }
    logDebug("Global bin dir:", stdout.trim());
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function detectInstallMethod(): Promise<InstallMethod> {
  logDebug("Detecting install method, execPath:", process.execPath);

  if (isBinaryInstall()) {
    logDebug("Install method: binary");
    return { type: "binary", binaryPath: process.execPath };
  }

  if (isProtoInstall()) {
    const protoCmd = (await resolveCommand("proto")) ?? "proto";
    logDebug("Install method: proto, cmd:", protoCmd);
    return { type: "proto", protoCmd };
  }

  if (isLocalInstall()) {
    const local = await detectLocalPm();
    if (local) {
      logDebug("Install method: local, pm:", local.cmd);
      return { type: "local", ...local };
    }
  }

  const binaryPath = process.execPath;
  logDebug(
    "Checking package managers:",
    PACKAGE_MANAGERS.map((pm) => pm.name).join(", ")
  );

  const candidates = await Promise.all(
    PACKAGE_MANAGERS.map(async (pm) => {
      const resolved = await resolveCommand(pm.name);
      if (!resolved) return null;
      const globalBinCmd = [resolved, ...pm.globalBinCmd.slice(1)];
      const binDir = await getGlobalBinDir(globalBinCmd);
      logDebug(
        "PM candidate:",
        pm.name,
        "resolved:",
        resolved,
        "binDir:",
        binDir
      );
      return { pm, resolved, binDir };
    })
  );

  const match = candidates.find(
    (c) => c?.binDir && binaryPath.startsWith(c.binDir)
  );

  if (match) {
    logDebug("Install method: package-manager, matched:", match.pm.name);
    return {
      type: "package-manager",
      cmd: match.resolved,
      args: match.pm.upgradeArgs,
      manualHint: `${match.pm.name} ${match.pm.upgradeArgs.join(" ")}`,
    };
  }

  logDebug("Install method: package-manager (fallback to npm)");
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
// Download progress display
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Create a progress callback that renders an updating line on stderr.
 * Returns `undefined` when stderr is not a TTY (piped / CI) — in that case
 * the download runs silently and the existing "Upgrading X -> Y..." message
 * is sufficient feedback.  Per ARCH-003: no progress output without a TTY.
 */
function createDownloadProgress(): DownloadProgressCallback | undefined {
  if (!process.stderr.isTTY) return undefined;

  return ({ downloadedBytes, totalBytes }) => {
    clearLine(process.stderr, 0);
    cursorTo(process.stderr, 0);
    const downloaded = formatBytes(downloadedBytes);
    if (totalBytes) {
      const total = formatBytes(totalBytes);
      const percent = Math.round((downloadedBytes / totalBytes) * 100);
      process.stderr.write(
        `Downloading... ${downloaded} / ${total} (${percent}%)`
      );
    } else {
      process.stderr.write(`Downloading... ${downloaded}`);
    }
  };
}

/** Clear the progress line so subsequent output starts on a fresh line. */
function finishDownloadProgress(): void {
  if (!process.stderr.isTTY) return;
  clearLine(process.stderr, 0);
  cursorTo(process.stderr, 0);
}

// ---------------------------------------------------------------------------
// Binary upgrade
// ---------------------------------------------------------------------------

async function upgradeBinary(tag: string): Promise<void> {
  logDebug("Upgrading via binary download for tag:", tag);
  const artifact = getArtifactInfo();
  if (!artifact) {
    logError(
      `Unsupported platform: ${getPlatformInfo().runtime}/${process.arch}`,
      "archgate supports darwin/arm64, linux/x64, and win32/x64."
    );
    await exitWith(1);
    return;
  }

  logDebug("Artifact:", artifact.name, "ext:", artifact.ext);
  const hint = getManualInstallHint();
  try {
    const onProgress = createDownloadProgress();
    const newBinaryPath = await downloadReleaseBinary(
      tag,
      artifact,
      onProgress
    );
    finishDownloadProgress();
    logDebug("Downloaded binary to:", newBinaryPath);
    logDebug("Replacing binary:", process.execPath);
    replaceBinary(process.execPath, newBinaryPath);
  } catch (err) {
    if (err instanceof Error && err.name === "ExitPromptError") throw err;
    finishDownloadProgress();
    logError(
      "Failed to upgrade binary.",
      `${err instanceof Error ? err.message : String(err)}\nTry running \`${hint}\` manually.`
    );
    await exitWith(1);
  }
}

async function runExternalUpgrade(
  cmd: string[],
  manualHint: string
): Promise<void> {
  logDebug("Running external upgrade:", cmd.join(" "));
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;
  logDebug("External upgrade exit code:", exitCode);

  if (exitCode !== 0) {
    logError(
      "Failed to install the latest version.",
      `Try running \`${manualHint}\` manually.`
    );
    await exitWith(1);
  }
}

export function registerUpgradeCommand(program: Command) {
  program
    .command("upgrade")
    .description("Upgrade Archgate to the latest version")
    .action(async () => {
      try {
        console.log("Checking for latest Archgate release...");

        const tag = await fetchLatestGitHubVersion();
        logDebug("GitHub latest tag:", tag ?? "(null)");
        if (!tag) {
          logError(
            "Failed to fetch release info from GitHub.",
            "Check your network connection."
          );
          await exitWith(1);
          return;
        }

        const packageJson = await import("../../package.json");
        const currentVersion = packageJson.default.version;
        const latestVersion = tag.replace(/^v/, "");
        logDebug("Version comparison:", currentVersion, "vs", latestVersion);
        const order = semver.order(currentVersion, latestVersion);

        if (order === null) {
          logError(
            `Could not compare versions: ${currentVersion} vs ${latestVersion}`
          );
          await exitWith(2);
          return;
        }

        if (order >= 0) {
          console.log(`Archgate is already up-to-date (${currentVersion}).`);
          await exitWith(0);
          return;
        }

        console.log(`Upgrading ${currentVersion} -> ${latestVersion}...`);

        const method = await detectInstallMethod();
        logDebug("Upgrade method:", method.type);

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

        trackUpgradeResult({
          from_version: currentVersion,
          to_version: latestVersion,
          install_method: method.type,
          success: true,
        });

        console.log(`Archgate upgraded to ${latestVersion} successfully.`);
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") throw err;
        trackUpgradeResult({
          from_version: "unknown",
          to_version: "unknown",
          install_method: "unknown",
          success: false,
        });
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });
}

/** @internal test hooks — consumed via dynamic import() in upgrade.test.ts */
export {
  isBinaryInstall as _isBinaryInstall,
  isProtoInstall as _isProtoInstall,
  isLocalInstall as _isLocalInstall,
  detectInstallMethod as _detectInstallMethod,
};
