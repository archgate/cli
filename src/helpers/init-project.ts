import { basename } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { createPathIfNotExists, projectPaths } from "./paths";
import { generateExampleAdr } from "./adr-templates";
import { configureClaudeSettings } from "./claude-settings";
import { configureCursorSettings } from "./cursor-settings";
import { configureVscodeSettings } from "./vscode-settings";
import { configureCopilotSettings } from "./copilot-settings";

export type EditorTarget = "claude" | "cursor" | "vscode" | "copilot";

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
 * Initialize an archgate governance directory. Shared by CLI command and MCP tool.
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
    plugin = await tryInstallPlugin(projectRoot, editor);
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
      // VS Code: .vscode/mcp.json always, marketplace URL to user settings if logged in
      const { loadCredentials } = await import("./auth");
      const creds = await loadCredentials();
      const marketplaceUrl = creds
        ? (await import("./plugin-install")).buildMarketplaceUrl(creds)
        : undefined;
      return configureVscodeSettings(projectRoot, marketplaceUrl);
    }
    case "copilot":
      return configureCopilotSettings(projectRoot);
    default:
      return configureClaudeSettings(projectRoot);
  }
}

/**
 * Attempt to install the archgate plugin using stored credentials.
 * Returns null-safe result — never throws.
 */
async function tryInstallPlugin(
  projectRoot: string,
  editor: EditorTarget
): Promise<PluginResult> {
  const { loadCredentials } = await import("./auth");
  const credentials = await loadCredentials();
  if (!credentials) {
    return { installed: false };
  }

  if (editor === "cursor") {
    const { installCursorPlugin } = await import("./plugin-install");
    const files = await installCursorPlugin(projectRoot, credentials.token);
    return {
      installed: true,
      autoInstalled: true,
      detail: `Extracted ${files.length} files to .cursor/`,
    };
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

  if (editor === "copilot") {
    const { isCopilotCliAvailable, installCopilotPlugin, buildMarketplaceUrl } =
      await import("./plugin-install");

    if (await isCopilotCliAvailable()) {
      try {
        await installCopilotPlugin(credentials);
        return { installed: true, autoInstalled: true };
      } catch {
        // Fall through to manual instructions
      }
    }

    const url = buildMarketplaceUrl(credentials);
    return { installed: true, detail: url };
  }

  // Claude Code — try auto-install via `claude` CLI, fall back to manual URL
  const { isClaudeCliAvailable, installClaudePlugin, buildMarketplaceUrl } =
    await import("./plugin-install");

  if (await isClaudeCliAvailable()) {
    try {
      await installClaudePlugin(credentials);
      return { installed: true, autoInstalled: true };
    } catch {
      // Fall through to manual instructions
    }
  }

  const url = buildMarketplaceUrl(credentials);
  return { installed: true, detail: url };
}
