#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import { semver } from "bun";

import packageJson from "../package.json";
import { registerAdrCommand } from "./commands/adr/index";
import { registerCheckCommand } from "./commands/check";
import { registerCleanCommand } from "./commands/clean";
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
import { isSupportedPlatform } from "./helpers/platform";
import { captureException, initSentry } from "./helpers/sentry";
import {
  flushTelemetry,
  initTelemetry,
  trackCommand,
} from "./helpers/telemetry";
import { checkForUpdatesIfNeeded } from "./helpers/update-check";

if (typeof Bun === "undefined")
  throw new Error(
    "You need to run `archgate` with Bun. Do `bunx archgate [command]`"
  );

if (!semver.satisfies(Bun.version, ">=1.2.21"))
  throw new Error("You need to update Bun to version 1.2.21 or higher");

if (!isSupportedPlatform())
  throw new Error("Archgate only supports macOS, Linux, and Windows");

createPathIfNotExists(paths.cacheFolder);

async function main() {
  await installGit();

  // Initialize telemetry and error tracking (no-op if opted out)
  initTelemetry();
  initSentry();

  const program = new Command()
    .name("archgate")
    .version(packageJson.version)
    .description("AI governance for software development");

  // Track which command is being executed
  program.hook("preAction", (thisCommand) => {
    const fullCommand = getFullCommandName(thisCommand);
    trackCommand(fullCommand);
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
  registerTelemetryCommand(program);

  const isUpgrade = process.argv.includes("upgrade");
  const updateCheckPromise = isUpgrade
    ? Promise.resolve(null)
    : checkForUpdatesIfNeeded(packageJson.version);
  await program.parseAsync(process.argv);
  const notice = await updateCheckPromise;
  if (notice) console.log(notice);

  // Flush telemetry events (fire-and-forget, with timeout)
  await flushTelemetry();
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

main().catch((err: unknown) => {
  captureException(err, { command: "main" });
  logError(String(err));
  process.exit(2);
});
