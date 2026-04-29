import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

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
import { writeRulesShim } from "./rules-shim";
import { configureVscodeSettings } from "./vscode-settings";

export type EditorTarget =
  | "claude"
  | "cursor"
  | "vscode"
  | "copilot"
  | "opencode";

export const EDITOR_LABELS: Record<EditorTarget, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  vscode: "VS Code",
  copilot: "Copilot CLI",
  opencode: "opencode",
};

export interface InitOptions {
  editor?: EditorTarget;
  /** When true, attempt to install the archgate plugin using stored credentials. */
  installPlugin?: boolean;
}

export interface PluginResult {
  installed: boolean;
  /** For claude manual: marketplace URL; for cursor: file count summary */
  detail?: string;
  /** When true, plugin was auto-installed via editor CLI (no manual steps needed). */
  autoInstalled?: boolean;
}

export interface InitResult {
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

  // Ensure generated shim files are gitignored
  await ensureGitignoreEntries(projectRoot);

  // Disable triple-slash-reference lint rule for .archgate/adrs/ if linter detected
  await ensureLinterOverrides(projectRoot);

  // Only generate the example ADR when no ADRs exist yet
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

  // Plugin installation (optional — requires stored credentials)
  let plugin: PluginResult | undefined;
  if (options?.installPlugin) {
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

/**
 * Route editor settings configuration to the appropriate helper.
 */
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
      // summary has something meaningful to print.
      return opencodeAgentsDir();
    default:
      return configureClaudeSettings(projectRoot);
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

  const config = await Bun.file(configPath).json();
  const overrides: unknown[] = config.overrides ?? [];
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
 * Returns null-safe result — never throws.
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
    const {
      isCursorCliAvailable,
      installCursorPlugin,
      buildCursorMarketplaceUrl,
    } = await import("./plugin-install");

    if (await isCursorCliAvailable()) {
      try {
        await installCursorPlugin(credentials.token);
        return { installed: true, autoInstalled: true };
      } catch (error) {
        // Fall through to manual instructions
        logDebug("Failed to auto-install Cursor plugin:", error);
      }
    }

    const url = buildCursorMarketplaceUrl();
    return { installed: true, detail: url };
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
    const { isOpencodeCliAvailable, installOpencodePlugin } =
      await import("./plugin-install");

    // Writing agent markdown to `~/.config/opencode/agents/` is only useful
    // if opencode itself is on PATH — otherwise we leave stale files in a
    // directory nothing reads. Mirror the detect-before-install guard that
    // every other editor's install path already uses.
    if (!(await isOpencodeCliAvailable())) {
      return {
        installed: true,
        // `cli-not-found` is a marker recognized by `printManualInstructions`
        // in `commands/init.ts`; the user-facing message lives there.
        detail: "cli-not-found",
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
      isCopilotCliAvailable,
      installCopilotPlugin,
      buildVscodeMarketplaceUrl,
    } = await import("./plugin-install");

    if (await isCopilotCliAvailable()) {
      try {
        await installCopilotPlugin();
        return { installed: true, autoInstalled: true };
      } catch (error) {
        // Fall through to manual instructions
        logDebug("Failed to auto-install Copilot plugin:", error);
      }
    }

    const url = buildVscodeMarketplaceUrl();
    return { installed: true, detail: url };
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
