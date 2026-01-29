#!/usr/bin/env bun
import { Command } from "@commander-js/extra-typings";
import packageJson from "../package.json";
import { createPathIfNotExists, paths } from "./helpers/paths";
import { semver } from "bun";
import { installGit } from "./helpers/git";
import { registerInitCommand } from "./commands/init";
import { registerAdrCommand } from "./commands/adr/index";
import { registerUpgradeCommand } from "./commands/upgrade";
import { registerCleanCommand } from "./commands/clean";
import { registerCheckCommand } from "./commands/check";
import { registerLoginCommand } from "./commands/login";
import { registerMcpCommand } from "./commands/mcp";
import { checkForUpdatesIfNeeded } from "./helpers/update-check";
import { logError } from "./helpers/log";

if (typeof Bun === "undefined")
  throw new Error(
    "You need to run `archgate` with Bun. Do `bunx archgate [command]`"
  );

if (!semver.satisfies(Bun.version, ">=1.2.21"))
  throw new Error("You need to update Bun to version 1.2.21 or higher");

if (!["darwin", "linux", "win32"].includes(process.platform))
  throw new Error("Archgate only supports macOS, Linux, and Windows");

createPathIfNotExists(paths.cacheFolder);

async function main() {
  await installGit();

  const program = new Command()
    .name("archgate")
    .version(packageJson.version)
    .description("AI governance for software development");

  registerInitCommand(program);
  registerLoginCommand(program);
  registerAdrCommand(program);
  registerCheckCommand(program);
  registerMcpCommand(program);
  registerUpgradeCommand(program);
  registerCleanCommand(program);

  const updateCheckPromise = checkForUpdatesIfNeeded(packageJson.version);
  await program.parseAsync(process.argv);
  const notice = await updateCheckPromise;
  if (notice) console.log(notice);
}

main().catch((err: unknown) => {
  logError(String(err));
  process.exit(2);
});
