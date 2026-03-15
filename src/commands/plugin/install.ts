import type { Command } from "@commander-js/extra-typings";
import { styleText } from "node:util";
import { loadCredentials } from "../../helpers/auth";
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
import { logError, logInfo, logWarn } from "../../helpers/log";

const VALID_EDITORS = ["claude", "cursor", "vscode", "copilot"] as const;
type EditorTarget = (typeof VALID_EDITORS)[number];

const EDITOR_LABELS: Record<EditorTarget, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  vscode: "VS Code",
  copilot: "Copilot CLI",
};

export function registerPluginInstallCommand(plugin: Command) {
  plugin
    .command("install")
    .description("Install the archgate plugin for the specified editor")
    .option(
      "--editor <editor>",
      "target editor (claude, cursor, vscode, copilot)",
      "claude"
    )
    .action(async (opts) => {
      const editor = opts.editor;
      if (!VALID_EDITORS.includes(editor as EditorTarget)) {
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

      const target = editor as EditorTarget;
      const label = EDITOR_LABELS[target];

      try {
        switch (target) {
          case "claude": {
            if (await isClaudeCliAvailable()) {
              await installClaudePlugin(credentials);
              logInfo(`Archgate plugin installed for ${label}.`);
            } else {
              const url = buildMarketplaceUrl(credentials);
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
              await installCopilotPlugin(credentials);
              logInfo(`Archgate plugin installed for ${label}.`);
            } else {
              const url = buildMarketplaceUrl(credentials);
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
            const files = await installCursorPlugin(
              process.cwd(),
              credentials.token
            );
            logInfo(
              `Archgate plugin installed for ${label}.`,
              `Extracted ${files.length} files to .cursor/`
            );
            break;
          }

          case "vscode": {
            const url = buildVscodeMarketplaceUrl(credentials);
            await configureVscodeSettings(process.cwd(), url);
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
