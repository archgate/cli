import type { Command } from "@commander-js/extra-typings";
import { styleText } from "node:util";
import { logError, logInfo, logWarn } from "../helpers/log";
import { initProject } from "../helpers/init-project";
import type { EditorTarget } from "../helpers/init-project";
import { loadCredentials } from "../helpers/auth";

const VALID_EDITORS = ["claude", "cursor", "vscode", "copilot"] as const;

const EDITOR_LABELS: Record<EditorTarget, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  vscode: "VS Code",
  copilot: "Copilot CLI",
};

const EDITOR_DIRS: Record<EditorTarget, string> = {
  claude: ".claude/",
  cursor: ".cursor/",
  vscode: ".vscode/",
  copilot: ".github/copilot/",
};

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Initialize Archgate governance in the current project")
    .option(
      "--editor <editor>",
      "editor integration to configure (claude, cursor, vscode, copilot)",
      "claude"
    )
    .option(
      "--install-plugin",
      "install the archgate plugin (requires prior `archgate login`)"
    )
    .action(async (opts) => {
      try {
        const editor = opts.editor as string;
        if (!VALID_EDITORS.includes(editor as EditorTarget)) {
          logError(
            `Unknown editor "${editor}". Supported: ${VALID_EDITORS.join(", ")}`
          );
          process.exit(1);
        }

        // Auto-detect: install plugin if credentials exist (unless explicitly off)
        const installPlugin =
          opts.installPlugin ?? (await loadCredentials()) !== null;

        const result = await initProject(process.cwd(), {
          editor: editor as EditorTarget,
          installPlugin,
        });

        const editorTarget = editor as EditorTarget;
        const label = EDITOR_LABELS[editorTarget];
        const dir = EDITOR_DIRS[editorTarget];

        console.log(`Initialized Archgate governance in ${result.projectRoot}`);
        console.log(`  adrs/          - architecture decision records`);
        console.log(`  lint/          - linter-specific rules`);
        console.log(`  ${dir.padEnd(13)}- ${label} settings configured`);

        // Plugin install output
        if (result.plugin?.installed) {
          console.log("");
          if (result.plugin.autoInstalled) {
            logInfo(`Archgate plugin installed for ${label}.`);
            if (result.plugin.detail) {
              console.log(`  ${result.plugin.detail}`);
            }
          } else {
            // CLI not found for this editor — show manual commands
            printManualInstructions(editorTarget, result.plugin.detail);
          }
        } else if (installPlugin) {
          // User wanted plugin but no credentials
          logWarn(
            "Plugin not installed — not logged in.",
            "Run `archgate login` first, then re-run `archgate init --install-plugin`."
          );
        }
      } catch (err) {
        logError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}

/**
 * Print manual plugin installation instructions when the editor CLI is not available.
 */
function printManualInstructions(editor: EditorTarget, detail?: string): void {
  switch (editor) {
    case "claude":
      logWarn("Claude CLI not found. To install the plugin manually, run:");
      console.log(
        `  ${styleText("bold", "claude plugin marketplace add")} ${detail}`
      );
      console.log(
        `  ${styleText("bold", "claude plugin install")} archgate@archgate`
      );
      break;
    case "copilot":
      logWarn("Copilot CLI not found. To install the plugin manually, run:");
      console.log(`  ${styleText("bold", "copilot plugin install")} ${detail}`);
      break;
    default:
      // vscode and cursor auto-install always — should not reach here
      break;
  }
}
