import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { logError } from "../../helpers/log";
import {
  buildMarketplaceUrl,
  buildVscodeMarketplaceUrl,
} from "../../helpers/plugin-install";

const editorOption = new Option("--editor <editor>", "target editor")
  .choices(["claude", "vscode", "copilot"] as const)
  .default("claude" as const);

export function registerPluginUrlCommand(plugin: Command) {
  plugin
    .command("url")
    .description(
      "Print the plugin repository URL for manual configuration"
    )
    .addOption(editorOption)
    .action((opts) => {
      try {
        const url =
          opts.editor === "vscode"
            ? buildVscodeMarketplaceUrl()
            : buildMarketplaceUrl();

        console.log(url);
      } catch (err) {
        logError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
