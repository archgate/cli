// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { z } from "zod";

import { detectBaseRef } from "../engine/git-files";
import { generateExampleAdr } from "./adr-templates";
import { configureClaudeSettings } from "./claude-settings";
import { configureCopilotSettings } from "./copilot-settings";
import { configureCursorSettings } from "./cursor-settings";
import { logDebug } from "./log";
import {
  createPathIfNotExists,
  opencodeAgentsDir,
  projectPaths,
} from "./paths";
import { ensureBaseBranch } from "./project-config";
import { writeRulesShim } from "./rules-shim";
import { configureVscodeSettings } from "./vscode-settings";

export const EDITOR_TARGETS = [
  "claude",
  "cursor",
  "vscode",
  "copilot",
  "opencode",
] as const;

export type EditorTarget = (typeof EDITOR_TARGETS)[number];

export const EDITOR_LABELS: Record<EditorTarget, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  vscode: "VS Code",
  copilot: "GitHub Copilot",
  opencode: "opencode",
};

/** Values sent to the signup API — one per EditorTarget. */
export type SignupEditor =
  | "claude-code"
  | "vscode"
  | "copilot-cli"
  | "cursor"
  | "opencode";

export const SIGNUP_EDITORS: Record<EditorTarget, SignupEditor> = {
  claude: "claude-code",
  cursor: "cursor",
  vscode: "vscode",
  copilot: "copilot-cli",
  opencode: "opencode",
};

interface InitOptions {
  editor?: EditorTarget;
  /** When true, attempt to install the archgate plugin using stored credentials. */
  installPlugin?: boolean;
}

interface PluginResult {
  installed: boolean;
  /** For claude manual: marketplace URL; for cursor: file count summary */
  detail?: string;
  /** When true, plugin was auto-installed via editor CLI (no manual steps needed). */
  autoInstalled?: boolean;
  /** When true, the plugin is configured but takes effect on the editor's next launch. */
  deferred?: boolean;
}

interface InitResult {
  projectRoot: string;
  adrsDir: string;
  lintDir: string;
  editorSettingsPath: string;
  plugin?: PluginResult;
}

/**
 * Initialize an archgate governance directory.
 * Idempotent — safe to run multiple times. Existing files are overwritten,
 * directories are created only if missing, and editor settings are merged additively.
 */
export async function initProject(
  projectRoot: string,
  options?: InitOptions
): Promise<InitResult> {
  const paths = projectPaths(projectRoot);

  createPathIfNotExists(paths.adrsDir);
  createPathIfNotExists(paths.lintDir);

  // Generate rules.d.ts so .rules.ts files get type checking
  // without requiring node_modules
  await writeRulesShim(projectRoot);

  await ensureGitignoreEntries(projectRoot);

  // Disable triple-slash-reference lint rule for .archgate/adrs/ if linter detected
  await ensureLinterOverrides(projectRoot);

  const hasExistingAdrs =
    existsSync(paths.adrsDir) &&
    readdirSync(paths.adrsDir).some((f) => f.endsWith(".md"));

  if (!hasExistingAdrs) {
    const projectName = basename(projectRoot);
    const exampleAdr = generateExampleAdr(projectName);
    await Bun.write(`${paths.adrsDir}/GEN-001-example.md`, exampleAdr);
  }

  await Bun.write(
    `${paths.lintDir}/README.md`,
    `# Linter Rules

This directory hosts linter-specific rules that enforce your ADRs at the linter level.

## Convention

Place linter plugin files here, named by tool:

- \`oxlint.js\` — Custom oxlint rules (JavaScript plugin)
- \`eslint.js\` — Custom ESLint rules
- \`biome.js\` — Custom Biome rules

## Usage with oxlint

1. Create \`.archgate/lint/oxlint.js\` exporting your plugin rules.
2. Reference it in your oxlint config:

\`\`\`json
{
  "plugins": [".archgate/lint/oxlint.js"]
}
\`\`\`

## Why here?

Archgate standardizes \`.archgate/lint/\` as the location for linter rules that complement ADR checks. This keeps governance artifacts together — ADRs in \`adrs/\`, linter rules in \`lint/\`.
`
  );

  const editor = options?.editor ?? "claude";
  const editorSettingsPath = await configureEditorSettings(projectRoot, editor);

  // Auto-detect base branch and save to config.json when not already configured.
  // Runs after directory creation so .archgate/ exists for saveProjectConfig.
  await ensureBaseBranch(projectRoot, detectBaseRef);

  // Plugin installation (optional — requires stored credentials)
  let plugin: PluginResult | undefined;
  if (options?.installPlugin === true) {
    plugin = await tryInstallPlugin(editor);
  }

  return {
    projectRoot,
    adrsDir: paths.adrsDir,
    lintDir: paths.lintDir,
    editorSettingsPath,
    plugin,
  };
}

async function configureEditorSettings(
  projectRoot: string,
  editor: EditorTarget
): Promise<string> {
  switch (editor) {
    case "cursor":
      return configureCursorSettings(projectRoot);
    case "vscode": {
      // VS Code: marketplace URL to user settings (credentials provided by git credential manager)
      const { loadCredentials } = await import("./credential-store");
      const creds = await loadCredentials();
      const marketplaceUrl = creds
        ? (await import("./plugin-install")).buildVscodeMarketplaceUrl()
        : undefined;
      return configureVscodeSettings(projectRoot, marketplaceUrl);
    }
    case "copilot":
      return configureCopilotSettings(projectRoot);
    case "opencode":
      // Opencode agent files are user-scope and written by `tryInstallPlugin`
      // after authenticating against the plugins service. Nothing lands in
      // the project tree — return the resolved user-scope path so the init
      // summary has something meaningful to print. The opencode.json config
      // (default_agent) is set inside installOpencodePlugin() itself.
      return opencodeAgentsDir();
    case "claude":
      return configureClaudeSettings(projectRoot);
    default: {
      const exhaustiveCheck: never = editor;
      throw new Error(`Unhandled editor target: ${String(exhaustiveCheck)}`);
    }
  }
}

const GITIGNORE_ENTRIES = [".archgate/rules.d.ts"];
const GITIGNORE_HEADER =
  "# Archgate generated runtime (regenerated by archgate)";

/**
 * Ensure the generated rules shim files are listed in .gitignore.
 * Creates the .gitignore if it does not exist.
 */
async function ensureGitignoreEntries(projectRoot: string): Promise<void> {
  const gitignorePath = join(projectRoot, ".gitignore");
  let content = "";

  if (existsSync(gitignorePath)) {
    content = await Bun.file(gitignorePath).text();
  }

  const missing = GITIGNORE_ENTRIES.filter((entry) => !content.includes(entry));

  if (missing.length === 0) return;

  const block = `\n${GITIGNORE_HEADER}\n${missing.join("\n")}\n`;
  await Bun.write(gitignorePath, content + block);
}

const ARCHGATE_RULES_GLOB = ".archgate/adrs/*.rules.ts";
const TRIPLE_SLASH_RULE_ESLINT = "@typescript-eslint/triple-slash-reference";
const TRIPLE_SLASH_RULE_OXLINT = "typescript/triple-slash-reference";

const PlainObjectSchema = z.record(z.string(), z.unknown());

/** Narrow a parsed-JSON value to a plain object before touching its keys. */
function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return PlainObjectSchema.safeParse(value).success;
}

/**
 * Detect JSON-based linter configs and add an override to disable
 * the triple-slash-reference rule for archgate rule files.
 * Only modifies .oxlintrc.json and .eslintrc.json — JS configs
 * require manual setup (documented in the writing-rules guide).
 */
async function ensureLinterOverrides(projectRoot: string): Promise<void> {
  await ensureOxlintOverride(projectRoot);
  await ensureEslintrcOverride(projectRoot);
}

async function addJsonOverride(
  configPath: string,
  ruleName: string
): Promise<void> {
  if (!existsSync(configPath)) return;

  const raw = await Bun.file(configPath).text();
  if (raw.includes(ARCHGATE_RULES_GLOB)) return;

  const parsed: unknown = await Bun.file(configPath).json();
  const config: Record<string, unknown> = isJsonRecord(parsed) ? parsed : {};
  const overrides: unknown[] = Array.isArray(config.overrides)
    ? config.overrides
    : [];
  overrides.push({
    files: [ARCHGATE_RULES_GLOB],
    rules: { [ruleName]: "off" },
  });
  config.overrides = overrides;
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function ensureOxlintOverride(projectRoot: string): Promise<void> {
  await addJsonOverride(
    join(projectRoot, ".oxlintrc.json"),
    TRIPLE_SLASH_RULE_OXLINT
  );
}

async function ensureEslintrcOverride(projectRoot: string): Promise<void> {
  await addJsonOverride(
    join(projectRoot, ".eslintrc.json"),
    TRIPLE_SLASH_RULE_ESLINT
  );
}

/**
 * Attempt to install the archgate plugin using stored credentials.
 *
 * @param editor - The editor to install the plugin for.
 * @returns A result describing success or the reason for skipping. Never
 * throws, so a failed install cannot abort `archgate init`.
 */
async function tryInstallPlugin(editor: EditorTarget): Promise<PluginResult> {
  const { loadCredentials } = await import("./credential-store");
  const credentials = await loadCredentials();
  if (!credentials) {
    return {
      installed: false,
      detail:
        "No stored credentials found; plugin installation was not attempted.",
    };
  }

  if (editor === "cursor") {
    // Install directly into ~/.cursor/{skills,agents}/ — Cursor's
    // plugin subsystem is unreliable in CLI mode and absent in cloud.
    const { installCursorPlugin } = await import("./plugin-install");
    try {
      await installCursorPlugin(credentials.token);
      return { installed: true, autoInstalled: true };
    } catch (error) {
      logDebug("Failed to install Cursor components:", error);
      return {
        installed: true,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (editor === "vscode") {
    // VS Code marketplace URL is already added to user settings by configureEditorSettings.
    // The --install-plugin flag is a no-op for VS Code since init handles everything.
    return {
      installed: true,
      autoInstalled: true,
      detail: "Marketplace URL added to VS Code user settings",
    };
  }

  if (editor === "opencode") {
    const { isOpencodeAvailable, installOpencodePlugin } =
      await import("./plugin-install");

    // Install only when opencode exists — otherwise the agent markdown lands
    // in a directory nothing reads. `isOpencodeAvailable()` recognizes both
    // the CLI (on PATH) and the Desktop app (no CLI, same user-scope config
    // dir), mirroring every other editor's detect-before-install guard.
    if (!(await isOpencodeAvailable())) {
      return {
        installed: true,
        // `not-found` is a marker recognized by `printManualInstructions`
        // in `commands/init.ts`; the user-facing message lives there.
        detail: "not-found",
      };
    }

    try {
      await installOpencodePlugin(credentials.token);
      return { installed: true, autoInstalled: true };
    } catch (error) {
      // Surface as a non-auto install so init routes through
      // `printManualInstructions("opencode", detail)`, which prints a
      // retry hint to the user.
      logDebug("Failed to install opencode agent bundle:", error);
      return {
        installed: true,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (editor === "copilot") {
    const {
      isCopilotAvailable,
      installCopilotPlugin,
      buildVscodeMarketplaceUrl,
    } = await import("./plugin-install");

    // Install only when Copilot exists — the settings write would otherwise
    // target a directory nothing reads.
    if (!(await isCopilotAvailable())) {
      return {
        installed: true,
        // `not-found` is a marker recognized by `printManualInstructions`
        // in `commands/init.ts`; the user-facing message lives there.
        detail: "not-found",
      };
    }

    try {
      const { mode } = await installCopilotPlugin();
      return mode === "cli"
        ? { installed: true, autoInstalled: true }
        : {
            installed: true,
            autoInstalled: true,
            deferred: true,
            // Printed verbatim under the success line by `commands/init.ts`.
            detail:
              "Restart the GitHub Copilot app — the plugin installs automatically on next launch.",
          };
    } catch (error) {
      // Surface as a non-auto install so init routes through
      // `printManualInstructions("copilot", url)` with the marketplace URL.
      logDebug("Failed to auto-install Copilot plugin:", error);
      return { installed: true, detail: buildVscodeMarketplaceUrl() };
    }
  }

  // Claude Code — try auto-install via `claude` CLI, fall back to manual URL
  const { isClaudeCliAvailable, installClaudePlugin, buildMarketplaceUrl } =
    await import("./plugin-install");

  if (await isClaudeCliAvailable()) {
    try {
      await installClaudePlugin();
      return { installed: true, autoInstalled: true };
    } catch (error) {
      // Fall through to manual instructions
      logDebug("Failed to auto-install Claude plugin:", error);
    }
  }

  const url = buildMarketplaceUrl();
  return { installed: true, detail: url };
}
