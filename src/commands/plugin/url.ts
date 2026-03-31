import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

import {
  detectEditors,
  promptSingleEditorSelection,
} from "../../helpers/editor-detect";
import type { EditorTarget } from "../../helpers/init-project";
import { logError } from "../../helpers/log";
import {
  buildCursorMarketplaceUrl,
  buildMarketplaceUrl,
  buildVscodeMarketplaceUrl,
} from "../../helpers/plugin-install";

const editorOption = new Option(
  "--editor <editor>",
  "target editor (omit to auto-detect and select)"
).choices(["claude", "cursor", "vscode", "copilot"] as const);

export function registerPluginUrlCommand(plugin: Command) {
  plugin
    .command("url")
    .description("Print the plugin repository URL for manual configuration")
    .addOption(editorOption)
    .action(async (opts) => {
      try {
        let editor: EditorTarget;
        if (opts.editor) {
          editor = opts.editor;
        } else if (process.stdin.isTTY) {
          const detected = await detectEditors();
          editor = await promptSingleEditorSelection(detected);
        } else {
          editor = "claude";
        }

        const url =
          editor === "cursor"
            ? buildCursorMarketplaceUrl()
            : editor === "vscode"
              ? buildVscodeMarketplaceUrl()
              : buildMarketplaceUrl();

        console.log(url);
      } catch (err) {
        logError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
