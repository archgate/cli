/**
 * doctor.ts — Gathers system diagnostic information for debugging.
 *
 * Collects environment, installation, project, and integration details
 * without exposing sensitive data (tokens, paths with usernames are truncated).
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import packageJson from "../../package.json";
import { loadCredentials } from "./credential-store";
import { internalPath } from "./paths";
import { getPlatformInfo, resolveCommand } from "./platform";
import {
  isClaudeCliAvailable,
  isCopilotCliAvailable,
  isVscodeCliAvailable,
} from "./plugin-install";
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
// Install method detection
// ---------------------------------------------------------------------------

function detectInstallMethod(): string {
  const execPath = process.execPath;
  const home = Bun.env.HOME ?? Bun.env.USERPROFILE ?? "";
  const protoHome = Bun.env.PROTO_HOME ?? `${home}/.proto`;

  if (execPath.startsWith(`${home}/.archgate/bin`)) return "binary";
  if (execPath.startsWith(`${protoHome}/tools/archgate`)) return "proto";
  if (execPath.includes("node_modules")) return "local";
  return "global-pm";
}

// ---------------------------------------------------------------------------
// Project scanning
// ---------------------------------------------------------------------------

interface ProjectInfo {
  hasProject: boolean;
  adrCount: number;
  adrWithRulesCount: number;
  domains: string[];
}

function scanProject(): ProjectInfo {
  const adrsDir = join(process.cwd(), ".archgate", "adrs");
  const hasProject = existsSync(adrsDir);

  if (!hasProject) {
    return {
      hasProject: false,
      adrCount: 0,
      adrWithRulesCount: 0,
      domains: [],
    };
  }

  try {
    const entries = readdirSync(adrsDir);
    const mdFiles = entries.filter((f) => f.endsWith(".md"));
    const rulesFiles = entries.filter((f) => f.endsWith(".rules.ts"));

    // Extract unique domains from ADR filenames (prefix before first dash+digits)
    const domainSet = new Set<string>();
    for (const f of mdFiles) {
      const match = f.match(/^([A-Z]+)-\d+/);
      if (match) domainSet.add(match[1]);
    }

    return {
      hasProject: true,
      adrCount: mdFiles.length,
      adrWithRulesCount: rulesFiles.length,
      domains: [...domainSet].sort(),
    };
  } catch {
    return { hasProject: true, adrCount: 0, adrWithRulesCount: 0, domains: [] };
  }
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
    cursorPlugin: existsSync(
      join(cwd, ".cursor", "rules", "archgate-governance.mdc")
    ),
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
  const projectInfo = scanProject();
  const integrations = detectIntegrations();
  const configDir = internalPath();

  // Run async checks in parallel
  const [claudeCli, cursorCli, vscodeCli, copilotCli, gitCmd, credentials] =
    await Promise.all([
      isClaudeCliAvailable(),
      resolveCommand("cursor").then((r) => r !== null),
      isVscodeCliAvailable(),
      isCopilotCliAvailable(),
      resolveCommand("git").then((r) => r !== null),
      loadCredentials(),
    ]);

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
      has_project: projectInfo.hasProject,
      adr_count: projectInfo.adrCount,
      adr_with_rules_count: projectInfo.adrWithRulesCount,
      domains: projectInfo.domains,
    },
    editors: {
      claude_cli: claudeCli,
      cursor_cli: cursorCli,
      vscode_cli: vscodeCli,
      copilot_cli: copilotCli,
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
