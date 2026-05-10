// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";

import { registerPluginInstallCommand } from "./install";
import { registerPluginUrlCommand } from "./url";

export function registerPluginCommand(program: Command) {
  const plugin = program
    .command("plugin")
    .description("Manage archgate editor plugins");

  registerPluginUrlCommand(plugin);
  registerPluginInstallCommand(plugin);
}
