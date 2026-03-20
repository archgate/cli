import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { loadCredentials } from "../../helpers/auth";
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
      "Print the authenticated plugin repository URL for manual configuration"
    )
    .addOption(editorOption)
    .action(async (opts) => {
      try {
        const credentials = await loadCredentials();
        if (!credentials) {
          logError(
            "Not logged in.",
            "Run `archgate login` first to authenticate."
          );
          process.exit(1);
        }

        const url =
          opts.editor === "vscode"
            ? buildVscodeMarketplaceUrl(credentials)
            : buildMarketplaceUrl(credentials);

        console.log(url);
      } catch (err) {
        logError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
