// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import { loadCredentials } from "../../helpers/credential-store";
import {
  detectEditors,
  promptEditorSelection,
} from "../../helpers/editor-detect";
import { exitWith } from "../../helpers/exit";
import { EDITOR_LABELS } from "../../helpers/init-project";
import type { EditorTarget } from "../../helpers/init-project";
import { logError, logInfo, logWarn } from "../../helpers/log";
import { findProjectRoot } from "../../helpers/paths";
import {
  buildMarketplaceUrl,
  buildVscodeMarketplaceUrl,
  downloadVsix,
  installClaudePlugin,
  installCopilotPlugin,
  installCursorPlugin,
  installOpencodePlugin,
  installVscodeExtension,
  isClaudeCliAvailable,
  isCopilotCliAvailable,
  isCursorCliAvailable,
  isOpencodeCliAvailable,
  isVscodeCliAvailable,
} from "../../helpers/plugin-install";
import { configureVscodeSettings } from "../../helpers/vscode-settings";

const editorOption = new Option(
  "--editor <editor>",
  "target editor (omit to auto-detect and select)"
).choices(["claude", "cursor", "vscode", "copilot", "opencode"] as const);

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
        const vsixPath = await downloadVsix(token);
        logWarn("Cursor CLI not found. The VSIX has been downloaded:");
        console.log(`  ${styleText("bold", vsixPath)}`);
        console.log(
          `  Open Cursor → Ctrl+Shift+P → ${styleText("bold", "Extensions: Install from VSIX...")} → select the file above`
        );
      }
      break;
    }
    case "opencode": {
      // Writing agent files to `~/.config/opencode/agents/` is only useful
      // if opencode is actually installed. Skip the install and surface a
      // clear message otherwise, matching every other editor's guard.
      if (!(await isOpencodeCliAvailable())) {
        logWarn(
          "opencode CLI not found on PATH — skipping agent install.",
          "Install opencode from https://opencode.ai/docs/, then re-run:"
        );
        console.log(
          `  ${styleText("bold", "archgate plugin install --editor opencode")}`
        );
        break;
      }
      await installOpencodePlugin(token);
      logInfo(`Archgate agents installed for ${label}.`);
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

function printManualInstructions(editor: EditorTarget): void {
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
      logInfo("To install the plugin manually, run:");
      console.log(
        `  ${styleText("bold", "curl")} -H "Authorization: Bearer <token>" https://plugins.archgate.dev/api/vscode -o archgate.vsix`
      );
      console.log(
        `  Then in Cursor: Ctrl+Shift+P → ${styleText("bold", "Extensions: Install from VSIX...")} → select archgate.vsix`
      );
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
    case "opencode": {
      logInfo(
        "Retry the install, or refresh your credentials if they have expired:"
      );
      console.log(`  ${styleText("bold", "archgate login refresh")}`);
      console.log(
        `  ${styleText("bold", "archgate plugin install --editor opencode")}`
      );
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
      try {
        const credentials = await loadCredentials();
        if (!credentials) {
          logError(
            "Not logged in.",
            "Run `archgate login` first to authenticate."
          );
          await exitWith(1);
          return;
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

        const failures: {
          editor: EditorTarget;
          label: string;
          error: string;
        }[] = [];

        for (const editor of editors) {
          const label = EDITOR_LABELS[editor];
          try {
            // oxlint-disable-next-line no-await-in-loop -- sequential install with per-editor output
            await installForEditor(editor, label, credentials.token);
          } catch (err) {
            failures.push({
              editor,
              label,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Print all failures together at the end so they are easy to review
        if (failures.length > 0) {
          console.log();
          for (const { editor, label, error } of failures) {
            logError(`Failed to install plugin for ${label}.`, error);
            printManualInstructions(editor);
            console.log();
          }
          await exitWith(1);
        }
      } catch (err) {
        // Re-throw ExitPromptError so main().catch() handles Ctrl+C (exit 130)
        if (err instanceof Error && err.name === "ExitPromptError") throw err;
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });
}
