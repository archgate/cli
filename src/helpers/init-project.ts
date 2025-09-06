import { basename } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { createPathIfNotExists, projectPaths } from "./paths";
import { generateExampleAdr } from "./adr-templates";
import { configureClaudeSettings } from "./claude-settings";

export interface InitResult {
  projectRoot: string;
  adrsDir: string;
  lintDir: string;
  claudeSettingsPath: string;
}

/**
 * Initialize an archgate governance directory. Shared by CLI command and MCP tool.
 * Idempotent — safe to run multiple times. Existing files are overwritten,
 * directories are created only if missing, and Claude settings are merged additively.
 */
export async function initProject(projectRoot: string): Promise<InitResult> {
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

  const claudeSettingsPath = await configureClaudeSettings(projectRoot);

  return {
    projectRoot,
    adrsDir: paths.adrsDir,
    lintDir: paths.lintDir,
    claudeSettingsPath,
  };
}
