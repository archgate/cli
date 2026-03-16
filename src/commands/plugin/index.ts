import type { Command } from "@commander-js/extra-typings";
import { registerPluginUrlCommand } from "./url";
import { registerPluginInstallCommand } from "./install";

export function registerPluginCommand(program: Command) {
  const plugin = program
    .command("plugin")
    .description("Manage archgate editor plugins");

  registerPluginUrlCommand(plugin);
  registerPluginInstallCommand(plugin);
}
