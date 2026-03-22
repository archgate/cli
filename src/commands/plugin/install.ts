import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

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
              console.log(
                `\nNote: Your git credentials must be configured for plugins.archgate.dev.`
              );
              console.log(
                `Run ${styleText("bold", "gh auth login")} if you use GitHub CLI.`
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
            logWarn(
              "Cursor plugin installation requires GitHub credentials."
            );
            logInfo(
              "Please provide your GitHub personal access token (PAT) for authentication."
            );

            const { default: inquirer } = await import("inquirer");
            const { username } = await inquirer.prompt({
              type: "input",
              name: "username",
              message: "GitHub username:",
              validate: (v: string) =>
                v.trim().length > 0 || "Username is required",
            });
            const { token } = await inquirer.prompt({
              type: "password",
              name: "token",
              message: "GitHub token (PAT):",
              validate: (v: string) =>
                v.trim().length > 0 || "Token is required",
            });

            const projectRoot = findProjectRoot() ?? process.cwd();
            const files = await installCursorPlugin(
              projectRoot,
              username.trim(),
              token.trim()
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
              "Marketplace URL added to VS Code user settings.",
              "Note: Your git credentials must be configured for plugins.archgate.dev."
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
