import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";
import { Option } from "@commander-js/extra-typings";
import inquirer from "inquirer";

import {
  loadCredentials,
  requestDeviceCode,
  pollForAccessToken,
  getGitHubUser,
  claimArchgateToken,
  saveCredentials,
} from "../helpers/auth";
import { initProject } from "../helpers/init-project";
import type { EditorTarget } from "../helpers/init-project";
import { logError, logInfo, logWarn } from "../helpers/log";
import { SignupRequiredError, requestSignup } from "../helpers/signup";
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
            hasCredentials = await runInlineLogin(opts.editor);
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

/** Map init editor flags to signup editor identifiers. */
const SIGNUP_EDITORS: Record<EditorTarget, string> = {
  claude: "claude-code",
  cursor: "cursor",
  vscode: "vscode",
  copilot: "copilot-cli",
};

/**
 * Run the GitHub device flow + signup inline during init.
 * Returns true if credentials were obtained.
 */
async function runInlineLogin(editor: EditorTarget): Promise<boolean> {
  console.log("\nAuthenticating with GitHub...\n");

  const deviceCode = await requestDeviceCode();
  console.log(
    `Open ${styleText("bold", deviceCode.verification_uri)} in your browser`
  );
  console.log(
    `and enter the code: ${styleText(["bold", "green"], deviceCode.user_code)}\n`
  );
  console.log("Waiting for authorization...");

  const githubToken = await pollForAccessToken(
    deviceCode.device_code,
    deviceCode.interval,
    deviceCode.expires_in
  );

  const { login: githubUser, email: githubEmail } =
    await getGitHubUser(githubToken);
  logInfo(`GitHub user: ${styleText("bold", githubUser)}`);

  console.log("Claiming archgate plugin token...");
  let archgateToken: string;
  try {
    archgateToken = await claimArchgateToken(githubToken);
  } catch (err) {
    if (!(err instanceof SignupRequiredError)) throw err;

    console.log(
      `\nYour GitHub account ${styleText("bold", githubUser)} is not yet registered.`
    );
    console.log("Let's sign you up now.\n");

    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "email",
        message: "Email address:",
        default: githubEmail ?? undefined,
        validate: (v: string) =>
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || "Enter a valid email address",
      },
      {
        type: "input",
        name: "useCase",
        message: "How do you plan to use archgate?",
        validate: (v: string) =>
          v.trim().length > 0 || "Please describe your use case",
      },
    ]);

    console.log("\nSubmitting signup request...");
    const result = await requestSignup(
      githubUser,
      answers.email,
      answers.useCase,
      SIGNUP_EDITORS[editor]
    );

    if (!result.ok) {
      logError("Signup request failed. Continuing without plugin.");
      return false;
    }

    archgateToken = result.token ?? (await claimArchgateToken(githubToken));
  }

  await saveCredentials({
    token: archgateToken,
    github_user: githubUser,
    created_at: new Date().toISOString().split("T")[0],
  });

  logInfo(
    `Authenticated as ${styleText("bold", githubUser)}. Continuing with plugin installation.\n`
  );
  return true;
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
      // cursor auto-installs always — should not reach here
      break;
  }
}
