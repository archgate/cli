import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { loadCredentials } from "../../helpers/credential-store";
import {
  detectEditors,
  promptEditorSelection,
} from "../../helpers/editor-detect";
import { EDITOR_LABELS } from "../../helpers/init-project";
import type { EditorTarget } from "../../helpers/init-project";
import { logError, logInfo, logWarn } from "../../helpers/log";
import { findProjectRoot } from "../../helpers/paths";
import {
  buildCursorMarketplaceUrl,
  buildMarketplaceUrl,
  buildVscodeMarketplaceUrl,
  installClaudePlugin,
  installCopilotPlugin,
  installCursorPlugin,
  installVscodeExtension,
  isClaudeCliAvailable,
  isCopilotCliAvailable,
  isCursorCliAvailable,
  isVscodeCliAvailable,
} from "../../helpers/plugin-install";
import { configureVscodeSettings } from "../../helpers/vscode-settings";

const editorOption = new Option(
  "--editor <editor>",
  "target editor (omit to auto-detect and select)"
).choices(["claude", "cursor", "vscode", "copilot"] as const);

async function installForEditor(
  editor: EditorTarget,
  label: string,
  token: string
): Promise<void> {
  switch (editor) {
    case "claude": {
      if (await isClaudeCliAvailable()) {
        await installClaudePlugin();
        logInfo(`Archgate plugin installed for ${label}.`);
      } else {
        const url = buildMarketplaceUrl();
        logWarn("Claude CLI not found. To install the plugin manually, run:");
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
        const url = buildVscodeMarketplaceUrl();
        logWarn("Copilot CLI not found. To install the plugin manually, run:");
        console.log(
          `  ${styleText("bold", "copilot plugin marketplace add")} ${url}`
        );
        console.log(
          `  ${styleText("bold", "copilot plugin install")} archgate@archgate`
        );
      }
      break;
    }
    case "cursor": {
      if (await isCursorCliAvailable()) {
        await installCursorPlugin(token);
        logInfo(`Archgate extension installed for ${label}.`);
      } else {
        logWarn("Cursor CLI not found. To install the plugin manually:");
        console.log(`  1. Install the VS Code extension in Cursor`);
        console.log(
          `  2. Add the Team Marketplace: ${buildCursorMarketplaceUrl()}`
        );
      }
      break;
    }
    case "vscode": {
      const url = buildVscodeMarketplaceUrl();
      await configureVscodeSettings(findProjectRoot() ?? process.cwd(), url);
      logInfo(
        `Archgate plugin configured for ${label}.`,
        "Marketplace URL added to VS Code user settings."
      );
      if (await isVscodeCliAvailable()) {
        await installVscodeExtension(token);
        logInfo(`Archgate extension installed for ${label}.`);
      } else {
        logWarn(
          "VS Code CLI (`code`) not found. To install the extension manually, run:"
        );
        console.log(
          `  ${styleText("bold", "curl")} -H "Authorization: Bearer <token>" https://plugins.archgate.dev/api/vscode -o archgate.vsix`
        );
        console.log(
          `  ${styleText("bold", "code")} --install-extension archgate.vsix`
        );
        console.log(`  rm archgate.vsix`);
      }
      break;
    }
  }
}

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

      // Resolve editors: explicit flag, interactive prompt, or default
      let editors: EditorTarget[];
      if (opts.editor) {
        editors = [opts.editor];
      } else if (process.stdin.isTTY) {
        const detected = await detectEditors();
        editors = await promptEditorSelection(detected);
      } else {
        editors = ["claude"];
      }

      for (const editor of editors) {
        const label = EDITOR_LABELS[editor];
        try {
          // oxlint-disable-next-line no-await-in-loop -- sequential install with per-editor output
          await installForEditor(editor, label, credentials.token);
        } catch (err) {
          logError(
            `Failed to install plugin for ${label}.`,
            err instanceof Error ? err.message : String(err)
          );

          // Show manual install commands so the user can retry themselves
          switch (editor) {
            case "claude": {
              const url = buildMarketplaceUrl();
              logInfo("To install the plugin manually, run:");
              console.log(
                `  ${styleText("bold", "claude plugin marketplace add")} ${url}`
              );
              console.log(
                `  ${styleText("bold", "claude plugin install")} archgate@archgate`
              );
              break;
            }
            case "copilot": {
              const url = buildVscodeMarketplaceUrl();
              logInfo("To install the plugin manually, run:");
              console.log(
                `  ${styleText("bold", "copilot plugin marketplace add")} ${url}`
              );
              console.log(
                `  ${styleText("bold", "copilot plugin install")} archgate@archgate`
              );
              break;
            }
            case "cursor": {
              const url = buildCursorMarketplaceUrl();
              logInfo("To install the plugin manually:");
              console.log(`  1. Install the VS Code extension in Cursor`);
              console.log(`  2. Add the Team Marketplace: ${url}`);
              break;
            }
            case "vscode": {
              logInfo("To install the extension manually, run:");
              console.log(
                `  ${styleText("bold", "curl")} -H "Authorization: Bearer <token>" https://plugins.archgate.dev/api/vscode -o archgate.vsix`
              );
              console.log(
                `  ${styleText("bold", "code")} --install-extension archgate.vsix`
              );
              console.log(`  rm archgate.vsix`);
              break;
            }
          }

          process.exit(1);
        }
      }
    });
}
