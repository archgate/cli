import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { loadCredentials } from "../../helpers/credential-store";
import { EDITOR_LABELS } from "../../helpers/init-project";
import { logError, logInfo, logWarn } from "../../helpers/log";
import { findProjectRoot } from "../../helpers/paths";
import {
  buildMarketplaceUrl,
  buildVscodeMarketplaceUrl,
  installClaudePlugin,
  installCopilotPlugin,
  installCursorPlugin,
  isClaudeCliAvailable,
  isCopilotCliAvailable,
} from "../../helpers/plugin-install";
import { configureVscodeSettings } from "../../helpers/vscode-settings";

const editorOption = new Option("--editor <editor>", "target editor")
  .choices(["claude", "cursor", "vscode", "copilot"] as const)
  .default("claude" as const);

export function registerPluginInstallCommand(plugin: Command) {
  plugin
    .command("install")
    .description("Install the archgate plugin for the specified editor")
    .addOption(editorOption)
    .action(async (opts) => {
      const credentials = await loadCredentials();
      if (!credentials) {
        logError(
          "Not logged in.",
          "Run `archgate login` first to authenticate."
        );
        process.exit(1);
      }

      const label = EDITOR_LABELS[opts.editor];

      try {
        switch (opts.editor) {
          case "claude": {
            if (await isClaudeCliAvailable()) {
              await installClaudePlugin();
              logInfo(`Archgate plugin installed for ${label}.`);
            } else {
              const url = buildMarketplaceUrl();
              logWarn(
                "Claude CLI not found. To install the plugin manually, run:"
              );
              console.log(
                `  ${styleText("bold", "claude plugin marketplace add")} ${url}`
              );
              console.log(
                `  ${styleText("bold", "claude plugin install")} archgate@archgate`
              );
            }
            break;
          }

          case "copilot": {
            if (await isCopilotCliAvailable()) {
              await installCopilotPlugin();
              logInfo(`Archgate plugin installed for ${label}.`);
            } else {
              const url = buildMarketplaceUrl();
              logWarn(
                "Copilot CLI not found. To install the plugin manually, run:"
              );
              console.log(
                `  ${styleText("bold", "copilot plugin install")} ${url}`
              );
            }
            break;
          }

          case "cursor": {
            const projectRoot = findProjectRoot() ?? process.cwd();
            const files = await installCursorPlugin(
              projectRoot,
              credentials.token
            );
            logInfo(
              `Archgate plugin installed for ${label}.`,
              `Extracted ${files.length} files to .cursor/`
            );
            break;
          }

          case "vscode": {
            const url = buildVscodeMarketplaceUrl();
            await configureVscodeSettings(
              findProjectRoot() ?? process.cwd(),
              url
            );
            logInfo(
              `Archgate plugin configured for ${label}.`,
              "Marketplace URL added to VS Code user settings."
            );
            break;
          }
        }
      } catch (err) {
        logError(
          `Failed to install plugin for ${label}.`,
          err instanceof Error ? err.message : String(err)
        );
        process.exit(1);
      }
    });
}
