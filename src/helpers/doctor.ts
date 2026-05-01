/**
 * doctor.ts — Gathers system diagnostic information for debugging.
 *
 * Collects environment, installation, project, and integration details
 * without exposing sensitive data (tokens, paths with usernames are truncated).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import packageJson from "../../package.json";
import { loadCredentials } from "./credential-store";
import { detectEditors } from "./editor-detect";
import { detectInstallMethod, getProjectContext } from "./install-info";
import { internalPath } from "./paths";
import { getPlatformInfo, resolveCommand } from "./platform";
import { isTelemetryEnabled } from "./telemetry-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DoctorReport {
  system: {
    os: NodeJS.Platform;
    arch: string;
    is_wsl: boolean;
    wsl_distro: string | null;
    bun_version: string;
    node_version: string;
  };
  archgate: {
    version: string;
    install_method: string;
    exec_path: string;
    config_dir: string;
    config_dir_exists: boolean;
    telemetry_enabled: boolean;
    logged_in: boolean;
  };
  project: {
    has_project: boolean;
    adr_count: number;
    adr_with_rules_count: number;
    domains: string[];
  };
  editors: {
    claude_cli: boolean;
    cursor_cli: boolean;
    vscode_cli: boolean;
    copilot_cli: boolean;
    git: boolean;
  };
  integrations: {
    claude_plugin: boolean;
    cursor_plugin: boolean;
    vscode_settings: boolean;
    copilot_settings: boolean;
  };
}

// ---------------------------------------------------------------------------
// Integration detection
// ---------------------------------------------------------------------------

interface IntegrationInfo {
  claudePlugin: boolean;
  cursorPlugin: boolean;
  vscodeSettings: boolean;
  copilotSettings: boolean;
}

function detectIntegrations(): IntegrationInfo {
  const cwd = process.cwd();
  return {
    claudePlugin: existsSync(join(cwd, ".claude", "settings.local.json")),
    // The Cursor plugin is embedded inside the archgate VS Code extension
    // (.vsix) and registered at runtime via registerPath(). There is no
    // project-level file to detect — report true when the cursor CLI exists
    // (prerequisite for VSIX installation).
    cursorPlugin: false, // resolved async below
    vscodeSettings: existsSync(join(cwd, ".vscode", "settings.json")),
    copilotSettings: existsSync(
      join(cwd, ".github", "copilot", "instructions.md")
    ),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runDoctor(): Promise<DoctorReport> {
  const platform = getPlatformInfo();
  const projectCtx = getProjectContext();
  const integrations = detectIntegrations();
  const configDir = internalPath();

  // Run async checks in parallel
  const [editors, gitCmd, credentials] = await Promise.all([
    detectEditors(),
    resolveCommand("git").then((r) => r !== null),
    loadCredentials(),
  ]);

  const editorMap = Object.fromEntries(editors.map((e) => [e.id, e.available]));

  // Cursor plugin is embedded in the VSIX — no project file to detect.
  // Use cursor CLI availability as a proxy (prerequisite for install).
  integrations.cursorPlugin = Boolean(editorMap.cursor);

  return {
    system: {
      os: platform.runtime,
      arch: process.arch,
      is_wsl: platform.isWSL,
      wsl_distro: platform.wslDistro,
      bun_version: Bun.version,
      node_version: process.version,
    },
    archgate: {
      version: packageJson.version,
      install_method: detectInstallMethod(),
      exec_path: process.execPath,
      config_dir: configDir,
      config_dir_exists: existsSync(configDir),
      telemetry_enabled: isTelemetryEnabled(),
      logged_in: credentials !== null,
    },
    project: {
      has_project: projectCtx.hasProject,
      adr_count: projectCtx.adrCount,
      adr_with_rules_count: projectCtx.adrWithRulesCount,
      domains: projectCtx.domains,
    },
    editors: {
      claude_cli: Boolean(editorMap.claude),
      cursor_cli: Boolean(editorMap.cursor),
      vscode_cli: Boolean(editorMap.vscode),
      copilot_cli: Boolean(editorMap.copilot),
      git: gitCmd,
    },
    integrations: {
      claude_plugin: integrations.claudePlugin,
      cursor_plugin: integrations.cursorPlugin,
      vscode_settings: integrations.vscodeSettings,
      copilot_settings: integrations.copilotSettings,
    },
  };
}
