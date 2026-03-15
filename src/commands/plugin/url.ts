import type { Command } from "@commander-js/extra-typings";
import { loadCredentials } from "../../helpers/auth";
import {
  buildMarketplaceUrl,
  buildVscodeMarketplaceUrl,
} from "../../helpers/plugin-install";
import { logError } from "../../helpers/log";

const VALID_EDITORS = ["claude", "cursor", "vscode", "copilot"] as const;

export function registerPluginUrlCommand(plugin: Command) {
  plugin
    .command("url")
    .description(
      "Print the authenticated plugin repository URL for manual configuration"
    )
    .option(
      "--editor <editor>",
      "target editor (claude, cursor, vscode, copilot)",
      "claude"
    )
    .action(async (opts) => {
      const editor = opts.editor;
      if (!VALID_EDITORS.includes(editor as (typeof VALID_EDITORS)[number])) {
        logError(
          `Unknown editor "${editor}". Supported: ${VALID_EDITORS.join(", ")}`
        );
        process.exit(1);
      }

      const credentials = await loadCredentials();
      if (!credentials) {
        logError(
          "Not logged in.",
          "Run `archgate login` first to authenticate."
        );
        process.exit(1);
      }

      const url =
        editor === "vscode"
          ? buildVscodeMarketplaceUrl(credentials)
          : buildMarketplaceUrl(credentials);

      console.log(url);
    });
}
