#!/usr/bin/env bun
import { Command, Option } from "@commander-js/extra-typings";
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
import { beginCommand, exitWith, finalizeCommand } from "./helpers/exit";
import { installGit } from "./helpers/git";
import { type LogLevel, logError, setLogLevel } from "./helpers/log";
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

  // Initialize error tracking and telemetry (no-ops if opted out).
  //
  // Both SDKs are lazy-loaded via dynamic `import()` inside these functions,
  // so the `ARCHGATE_TELEMETRY=0` path skips the parse/init cost entirely.
  //
  // Await telemetry so the repo context is resolved before the preAction
  // hook fires `command_executed` — otherwise that event always lands
  // without `repo_id` (see PR #211). The two init calls run concurrently,
  // so the wall-clock cost is bounded by whichever is slowest.
  await Promise.all([initSentry(), initTelemetry()]);

  const logLevelOption = new Option("--log-level <level>", "Set log verbosity")
    .choices(["error", "warn", "info", "debug"] as const)
    .default("info" as const);

  const program = new Command()
    .name("archgate")
    .version(packageJson.version)
    .description("AI governance for software development")
    .addOption(logLevelOption);

  // Track command execution for Sentry breadcrumbs and PostHog analytics.
  //
  // Commander invokes the hook callback with (hookedCommand, actionCommand);
  // the second arg is the actual subcommand being executed. We use the action
  // command so `adr create` etc. resolves correctly instead of always "root".
  program.hook("preAction", (_hookedCommand, actionCommand) => {
    // Apply log level from global option before any command runs
    const rootOpts = program.opts();
    setLogLevel(rootOpts.logLevel as LogLevel);
    const fullCommand = getFullCommandName(actionCommand);
    addBreadcrumb("command", `Running: ${fullCommand}`);
    // Collect which options were used (presence only, no values)
    const opts = actionCommand.opts() as Record<string, unknown>;
    const optionFlags: Record<string, boolean> = {};
    const optionsUsed: string[] = [];
    for (const key of Object.keys(opts)) {
      const val = opts[key];
      const used = val !== undefined && val !== false;
      optionFlags[`opt_${key}`] = used;
      if (used) optionsUsed.push(key);
    }
    const depth = fullCommand === "root" ? 0 : fullCommand.split(" ").length;
    trackCommand(fullCommand, {
      ...optionFlags,
      command_depth: depth,
      options_used: optionsUsed,
    });
    beginCommand(fullCommand);
  });

  program.hook("postAction", (_hookedCommand, actionCommand) => {
    const fullCommand = getFullCommandName(actionCommand);
    finalizeCommand(fullCommand, 0, "success");
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

  // Belt-and-braces: force exit so any stray handle left by a third-party
  // SDK (posthog-node, @sentry/node-core, etc.) can't linger and make the
  // CLI feel laggy. All flushes above have already completed.
  process.exit(0);
}

/**
 * Reconstruct the full command name from Commander's command chain.
 * E.g., "adr create" from the "create" subcommand of "adr".
 *
 * Typed against the loose Commander "unknown opts" shape because it's called
 * from the `preAction` / `postAction` hook callback, where Commander gives us
 * a `CommandUnknownOpts`, not the narrowly-typed `Command<[], {}, {}>`.
 */
function getFullCommandName(
  command: { name(): string; parent: unknown } | null
): string {
  const parts: string[] = [];
  let current = command;
  while (current) {
    const name = current.name();
    if (name && name !== "archgate") {
      parts.unshift(name);
    }
    current = current.parent as typeof command;
  }
  return parts.join(" ") || "root";
}

main().catch(async (err: unknown) => {
  // User pressed Ctrl+C during an Inquirer prompt — exit silently
  if (err instanceof Error && err.name === "ExitPromptError") {
    await exitWith(130, { outcome: "cancelled" });
  }

  captureException(err, { command: "main" });
  logError(String(err));
  await exitWith(2, {
    outcome: "internal_error",
    errorKind: classifyErrorKind(err),
  });
});

/**
 * Classify an error into a high-level bucket for telemetry.
 * Returns a short tag — never the raw error message.
 */
function classifyErrorKind(err: unknown): string {
  if (!(err instanceof Error)) return "unknown";
  const name = err.name || "Error";
  const msg = err.message || "";
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(msg)) return "network";
  if (/certificate|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(msg)) return "tls";
  if (/EACCES|EPERM/.test(msg)) return "permission";
  if (name === "SyntaxError") return "syntax";
  if (name === "TypeError") return "type";
  return name;
}
