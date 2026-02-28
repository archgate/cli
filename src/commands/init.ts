import type { Command } from "@commander-js/extra-typings";
import { styleText } from "node:util";
import { logError, logInfo, logWarn } from "../helpers/log";
import { initProject } from "../helpers/init-project";
import type { EditorTarget } from "../helpers/init-project";
import { loadCredentials } from "../helpers/auth";

const VALID_EDITORS = ["claude", "cursor"] as const;

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Initialize Archgate governance in the current project")
    .option(
      "--editor <editor>",
      "editor integration to configure (claude, cursor)",
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

        console.log(`Initialized Archgate governance in ${result.projectRoot}`);
        console.log(`  adrs/          - architecture decision records`);
        console.log(`  lint/          - linter-specific rules`);
        if (editor === "cursor") {
          console.log(`  .cursor/       - Cursor settings configured`);
        } else {
          console.log(`  .claude/       - Claude Code settings configured`);
        }

        // Plugin install output
        if (result.plugin?.installed) {
          console.log("");
          if (editor === "cursor") {
            logInfo("Archgate plugin installed for Cursor.");
            console.log(`  ${result.plugin.detail}`);
          } else {
            logInfo("To install the archgate plugin in Claude Code, run:");
            console.log(
              `  ${styleText("bold", "/plugin marketplace add")} ${result.plugin.detail}`
            );
            console.log(
              `  ${styleText("bold", "/plugin install")} archgate-governance@archgate`
            );
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
