#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import { semver } from "bun";

import packageJson from "../package.json";
import { registerAdrCommand } from "./commands/adr/index";
import { registerCheckCommand } from "./commands/check";
import { registerCleanCommand } from "./commands/clean";
import { registerDoctorCommand } from "./commands/doctor";
import { registerInitCommand } from "./commands/init";
import { registerLoginCommand } from "./commands/login";
import { registerPluginCommand } from "./commands/plugin/index";
import { registerReviewContextCommand } from "./commands/review-context";
import { registerSessionContextCommand } from "./commands/session-context/index";
import { registerTelemetryCommand } from "./commands/telemetry";
import { registerUpgradeCommand } from "./commands/upgrade";
import { installGit } from "./helpers/git";
import { logError } from "./helpers/log";
import { createPathIfNotExists, paths } from "./helpers/paths";
import { getPlatformInfo, isSupportedPlatform } from "./helpers/platform";
import {
  addBreadcrumb,
  captureException,
  flushSentry,
  initSentry,
} from "./helpers/sentry";
import {
  flushTelemetry,
  initTelemetry,
  trackCommand,
  trackCommandResult,
} from "./helpers/telemetry";
import { checkForUpdatesIfNeeded } from "./helpers/update-check";

// Pre-main environment guards — these are user-facing errors (exit 1), not bugs.
// The Bun check must throw (logError requires Bun APIs). The rest use logError
// for clean output.
if (typeof Bun === "undefined")
  throw new Error(
    "You need to run `archgate` with Bun. Do `bunx archgate [command]`"
  );

if (!semver.satisfies(Bun.version, ">=1.2.21")) {
  logError(
    "You need to update Bun to version 1.2.21 or higher.",
    `Current version: ${Bun.version}`
  );
  process.exit(1);
}

if (!isSupportedPlatform()) {
  const { runtime } = getPlatformInfo();
  logError(
    "Archgate only supports macOS, Linux, and Windows.",
    `Detected platform: ${runtime}/${process.arch}`
  );
  process.exit(1);
}

createPathIfNotExists(paths.cacheFolder);

async function main() {
  await installGit();

  // Initialize error tracking and telemetry (no-ops if opted out)
  initSentry();
  initTelemetry();

  const program = new Command()
    .name("archgate")
    .version(packageJson.version)
    .description("AI governance for software development");

  // Track command execution for Sentry breadcrumbs and PostHog analytics
  let commandStartTime = 0;
  program.hook("preAction", (thisCommand) => {
    const fullCommand = getFullCommandName(thisCommand);
    addBreadcrumb("command", `Running: ${fullCommand}`);
    // Collect which options were used (presence only, no values)
    const opts = thisCommand.opts() as Record<string, unknown>;
    const optionFlags: Record<string, boolean> = {};
    for (const key of Object.keys(opts)) {
      const val = opts[key];
      optionFlags[`opt_${key}`] = val !== undefined && val !== false;
    }
    trackCommand(fullCommand, optionFlags);
    commandStartTime = performance.now();
  });

  program.hook("postAction", (thisCommand) => {
    const fullCommand = getFullCommandName(thisCommand);
    const durationMs = Math.round(performance.now() - commandStartTime);
    trackCommandResult(fullCommand, 0, durationMs);
  });

  registerInitCommand(program);
  registerLoginCommand(program);
  registerAdrCommand(program);
  registerCheckCommand(program);
  registerReviewContextCommand(program);
  registerSessionContextCommand(program);
  registerPluginCommand(program);
  registerUpgradeCommand(program);
  registerCleanCommand(program);
  registerDoctorCommand(program);
  registerTelemetryCommand(program);

  const isUpgrade = process.argv.includes("upgrade");
  const updateCheckPromise = isUpgrade
    ? Promise.resolve(null)
    : checkForUpdatesIfNeeded(packageJson.version);
  await program.parseAsync(process.argv);
  const notice = await updateCheckPromise;
  if (notice) console.log(notice);

  // Flush telemetry and error tracking before exit
  await Promise.all([flushTelemetry(), flushSentry()]);
}

/**
 * Reconstruct the full command name from Commander's command chain.
 * E.g., "adr create" from the "create" subcommand of "adr".
 */
function getFullCommandName(command: Command): string {
  const parts: string[] = [];
  let current: Command | null = command;
  while (current) {
    const name = current.name();
    if (name && name !== "archgate") {
      parts.unshift(name);
    }
    current = current.parent as Command | null;
  }
  return parts.join(" ") || "root";
}

main().catch(async (err: unknown) => {
  // User pressed Ctrl+C during an Inquirer prompt — exit silently
  if (err instanceof Error && err.name === "ExitPromptError") {
    process.exit(130);
  }

  captureException(err, { command: "main" });
  await Promise.all([flushTelemetry(), flushSentry()]);
  logError(String(err));
  process.exit(2);
});
