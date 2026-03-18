import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";
import inquirer from "inquirer";

import { loadCredentials } from "../helpers/auth";
import { initProject } from "../helpers/init-project";
import type { EditorTarget } from "../helpers/init-project";
import { logError, logInfo, logWarn } from "../helpers/log";
import { runLoginFlow } from "../helpers/login-flow";
import { isTlsError, tlsHintMessage } from "../helpers/tls";

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

/** Map init editor flags to signup editor identifiers. */
const SIGNUP_EDITORS: Record<EditorTarget, string> = {
  claude: "claude-code",
  cursor: "cursor",
  vscode: "vscode",
  copilot: "copilot-cli",
};

const editorOption = new Option("--editor <editor>", "editor integration")
  .choices(["claude", "cursor", "vscode", "copilot"] as const)
  .default("claude" as const);

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Initialize Archgate governance in the current project")
    .addOption(editorOption)
    .option(
      "--install-plugin",
      "install the archgate plugin (requires prior `archgate login`)"
    )
    .action(async (opts) => {
      try {
        let hasCredentials = (await loadCredentials()) !== null;

        // If no credentials and --install-plugin not explicitly set, offer to log in
        // Skip interactive prompts in non-TTY environments (agent-driven runs)
        if (
          !hasCredentials &&
          opts.installPlugin === undefined &&
          process.stdin.isTTY
        ) {
          const { wantPlugin } = await inquirer.prompt([
            {
              type: "confirm",
              name: "wantPlugin",
              message:
                "Would you like to install the Archgate editor plugin? (requires GitHub login)",
              default: true,
            },
          ]);

          if (wantPlugin) {
            const result = await runLoginFlow({
              editor: SIGNUP_EDITORS[opts.editor],
            });
            hasCredentials = result.ok;
          }
        }

        const installPlugin = opts.installPlugin ?? hasCredentials;

        const result = await initProject(process.cwd(), {
          editor: opts.editor,
          installPlugin,
        });

        const label = EDITOR_LABELS[opts.editor];
        const dir = EDITOR_DIRS[opts.editor];

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
            printManualInstructions(opts.editor, result.plugin.detail);
          }
        } else if (installPlugin) {
          // User wanted plugin but no credentials
          logWarn(
            "Plugin not installed — not logged in.",
            "Run `archgate login` first, then re-run `archgate init --install-plugin`."
          );
        }
      } catch (err) {
        if (isTlsError(err)) {
          logError(tlsHintMessage());
          process.exit(1);
        }
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
      // cursor/vscode auto-install — should not reach here
      break;
  }
}
