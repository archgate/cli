// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cursorTo } from "node:readline";
import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";

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
import {
  trackGreenfieldWizardShown,
  trackInitResult,
  trackPackImportedAtInit,
  trackProjectInitialized,
  trackWizardSkipped,
} from "../helpers/telemetry";
import { isTlsError, tlsHintMessage } from "../helpers/tls";

const EDITOR_DIRS: Record<EditorTarget, string> = {
  claude: ".claude/",
  // Cursor plugin is embedded in the VSIX extension — no project-level
  // files are written. Shown as a label in the init summary.
  cursor: "(VSIX)",
  vscode: ".vscode/",
  copilot: ".github/copilot/",
  // Opencode agents install to a user-scope directory, not the project tree.
  // Shown as a shorthand in the init summary; the resolved absolute path is
  // printed via `result.plugin.detail` when the install succeeds.
  opencode: "(user-scope)",
};

/** Map init editor flags to signup editor identifiers. */
const SIGNUP_EDITORS: Record<EditorTarget, string> = {
  claude: "claude-code",
  cursor: "cursor",
  vscode: "vscode",
  copilot: "copilot-cli",
  opencode: "opencode",
};

const editorOption = new Option(
  "--editor <editor>",
  "editor integration (omit to auto-detect and select)"
).choices(["claude", "cursor", "vscode", "copilot", "opencode"] as const);

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
          // Lazy-load inquirer — it costs ~200ms to parse and is only needed
          // for interactive prompts, not for scripted or --help invocations.
          const { default: inquirer } = await import("inquirer");
          const { wantPlugin } = await inquirer.prompt([
            {
              type: "confirm",
              name: "wantPlugin",
              message:
                "Would you like to install the Archgate editor plugin? (requires GitHub login)",
              default: true,
            },
          ]);
          // Windows cursor-reset — see editor-detect.ts for explanation.
          if (process.stdout.isTTY) cursorTo(process.stdout, 0);

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

        // --- Greenfield wizard: offer starter packs when no ADRs exist ---
        if (process.stdin.isTTY && !hadExistingProject) {
          await runGreenfieldWizard(process.cwd());
        }
      } catch (err) {
        // Re-throw ExitPromptError so main().catch() handles Ctrl+C (exit 130)
        if (err instanceof Error && err.name === "ExitPromptError") throw err;
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
 * Greenfield wizard: detect project stack, recommend packs, and import
 * selected ones. Only shown in interactive mode when no ADRs existed before init.
 */
async function runGreenfieldWizard(projectRoot: string): Promise<void> {
  const { default: inquirer } = await import("inquirer");

  trackGreenfieldWizardShown();

  console.log("");
  const { wantPacks } = await inquirer.prompt([
    {
      type: "list",
      name: "wantPacks",
      message:
        "No existing ADRs detected. Would you like to import starter packs?",
      choices: [
        { name: "Yes, pick packs now (recommended)", value: true },
        { name: "No, start empty", value: false },
      ],
    },
  ]);
  // Windows cursor-reset — see editor-detect.ts for explanation.
  if (process.stdout.isTTY) cursorTo(process.stdout, 0);

  if (!wantPacks) {
    trackWizardSkipped();
    return;
  }

  const { detectStack } = await import("../helpers/stack-detect");
  const { recommendPacks } = await import("../helpers/pack-recommend");

  const stack = await detectStack(projectRoot);

  // Show detected stack summary
  const stackParts: string[] = [];
  if (stack.languages.length > 0) stackParts.push(...stack.languages);
  if (stack.runtimes.length > 0) stackParts.push(...stack.runtimes);
  if (stack.frameworks.length > 0) stackParts.push(...stack.frameworks);
  if (stackParts.length > 0) {
    console.log(
      styleText(
        "dim",
        `Detected: ${stackParts.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(", ")}`
      )
    );
  }

  console.log("");
  const recommendations = await recommendPacks(stack);

  if (recommendations.length === 0) {
    console.log("No matching packs found in the registry.");
    return;
  }

  const { selectedPacks } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "selectedPacks",
      message: "Select packs to import:",
      choices: recommendations.map((rec) => ({
        name: `${rec.packPath.padEnd(30)} ${String(rec.adrCount).padStart(2)} ADRs  (${rec.matchedTags.join(", ")})`,
        value: rec.packPath,
        checked: rec.relevance === "high",
      })),
    },
  ]);
  // Windows cursor-reset
  if (process.stdout.isTTY) cursorTo(process.stdout, 0);

  if (selectedPacks.length === 0) {
    console.log("No packs selected.");
    return;
  }

  // Import selected packs via subprocess to reuse existing import logic
  const args = [
    process.argv[0],
    "adr",
    "import",
    "--yes",
    ...selectedPacks,
  ];
  const proc = Bun.spawn(args, {
    cwd: projectRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;

  if (proc.exitCode === 0) {
    trackPackImportedAtInit({
      pack_names: selectedPacks,
      pack_count: selectedPacks.length,
    });
    console.log("");
    console.log(
      styleText(
        "green",
        `Imported ${selectedPacks.length} pack(s). Run \`archgate check\` to see your baseline.`
      )
    );
  } else {
    logWarn("Some packs may not have imported successfully.");
  }
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
    case "opencode":
      // `cli-not-found` is the sentinel set by `tryInstallPlugin` in
      // init-project.ts when the `opencode` binary is not on PATH. All other
      // values are error messages from a failed download/extract.
      if (detail === "cli-not-found") {
        logWarn(
          "opencode CLI not found on PATH — skipping agent install.",
          "Install opencode from https://opencode.ai/docs/, then run:"
        );
        console.log(
          `  ${styleText("bold", "archgate plugin install --editor opencode")}`
        );
      } else {
        logWarn(
          "Failed to install opencode agents.",
          detail ?? "Check your credentials and retry."
        );
        console.log(
          `  Retry with: ${styleText("bold", "archgate plugin install --editor opencode")}`
        );
        console.log(
          `  If the token has expired: ${styleText("bold", "archgate login refresh")}`
        );
      }
      break;
    case "cursor":
      if (detail && !detail.startsWith("download")) {
        // detail is the VSIX path or the error message from installCursorPlugin
        logWarn("Cursor CLI not found. The VSIX has been downloaded:");
        console.log(`  ${styleText("bold", detail)}`);
        console.log(
          `  Open Cursor → Ctrl+Shift+P → ${styleText("bold", "Extensions: Install from VSIX...")} → select the file above`
        );
      } else {
        logWarn(
          "Could not download the VSIX. Retry with:",
          `  ${styleText("bold", "archgate plugin install --editor cursor")}`
        );
      }
      break;
    default:
      // vscode auto-install — should not reach here
      break;
  }
}
