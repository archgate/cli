import { existsSync } from "node:fs";
import { join } from "node:path";
import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";
import inquirer from "inquirer";

import { loadCredentials } from "../helpers/credential-store";
import { detectEditors, promptEditorSelection } from "../helpers/editor-detect";
import { exitWith } from "../helpers/exit";
import { EDITOR_LABELS, initProject } from "../helpers/init-project";
import type { EditorTarget } from "../helpers/init-project";
import { logError, logInfo, logWarn } from "../helpers/log";
import { runLoginFlow } from "../helpers/login-flow";
import {
  getRepoContext,
  isPublicRepo,
  shouldShareRepoIdentity,
} from "../helpers/repo";
import { trackInitResult, trackProjectInitialized } from "../helpers/telemetry";
import { isTlsError, tlsHintMessage } from "../helpers/tls";

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

const editorOption = new Option(
  "--editor <editor>",
  "editor integration (omit to auto-detect and select)"
).choices(["claude", "cursor", "vscode", "copilot"] as const);

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

        const hadExistingProject = existsSync(
          join(process.cwd(), ".archgate", "adrs")
        );
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
              editor: SIGNUP_EDITORS[editors[0]],
            });
            hasCredentials = result.ok;
          }
        }

        const installPlugin = opts.installPlugin ?? hasCredentials;

        // Run init for each selected editor (sequential for ordered output)
        for (const editor of editors) {
          // oxlint-disable-next-line no-await-in-loop -- sequential init with per-editor output
          const result = await initProject(process.cwd(), {
            editor,
            installPlugin,
          });

          const label = EDITOR_LABELS[editor];
          const dir = EDITOR_DIRS[editor];

          if (editors.indexOf(editor) === 0) {
            console.log(
              `Initialized Archgate governance in ${result.projectRoot}`
            );
            console.log(`  adrs/          - architecture decision records`);
            console.log(`  lint/          - linter-specific rules`);
          }
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
              printManualInstructions(editor, result.plugin.detail);
            }
          } else if (installPlugin && editors.indexOf(editor) === 0) {
            logWarn(
              "Plugin not installed — not logged in.",
              "Run `archgate login` first, then re-run `archgate init --install-plugin`."
            );
          }

          trackInitResult({
            editor,
            plugin_installed: Boolean(result.plugin?.installed),
            plugin_auto_installed: Boolean(result.plugin?.autoInstalled),
            had_existing_project: hadExistingProject,
          });
        }

        // One-time `project_initialized` event. The hashed `repo_id` ships in
        // every event already via the common props; this richer event is the
        // only place the raw remote URL / owner / name appear, and only for
        // repositories we can confirm public via the host's unauthenticated
        // API. Users who don't want the event at all disable telemetry
        // (`ARCHGATE_TELEMETRY=0` / `archgate telemetry disable`) — no
        // identity-specific knob is needed on top of that.
        const repo = await getRepoContext();
        const repoPublic = await isPublicRepo(repo);
        const shareIdentity = shouldShareRepoIdentity(repoPublic);
        trackProjectInitialized({
          editors,
          editor_primary: editors[0],
          plugin_installed: installPlugin,
          had_existing_project: hadExistingProject,
          identity_shared: shareIdentity,
          repo_host: repo.host,
          repo_is_git: repo.isGit,
          repo_public: repoPublic,
          ...(shareIdentity
            ? {
                remote_url: repo.remoteUrl,
                repo_owner: repo.owner,
                repo_name: repo.name,
              }
            : {}),
        });
      } catch (err) {
        if (isTlsError(err)) {
          logError(tlsHintMessage());
          await exitWith(1);
        }
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
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
