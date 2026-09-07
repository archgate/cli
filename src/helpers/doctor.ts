// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * doctor.ts — Gathers system diagnostic information for debugging.
 *
 * Collects environment, installation, project, and integration details
 * without exposing sensitive data (tokens, paths with usernames are truncated).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import packageJson from "../../package.json";
import { loadCredentials, loadTokenSet } from "./credential-store";
import { detectEditors } from "./editor-detect";
import type { CredentialHelperStatus } from "./git-credential-config";
import { inspectGitCredentialHelper } from "./git-credential-config";
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
    /** Which kind of credential is stored; a legacy token predates sign-in. */
    session: "platform" | "legacy" | "none";
    /** The git credential helper entry `archgate login` writes. */
    credential_helper: CredentialHelperStatus;
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

/**
 * Name the stored credential.
 *
 * A stored platform session counts even when it could not be renewed: the
 * record is still there for `archgate login refresh` to replace. A legacy
 * token is whatever `loadCredentials` returned without a session behind it.
 */
function sessionKind(
  hasSession: boolean,
  hasCredentials: boolean
): DoctorReport["archgate"]["session"] {
  if (hasSession) return "platform";
  return hasCredentials ? "legacy" : "none";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runDoctor(): Promise<DoctorReport> {
  const platform = getPlatformInfo();
  const projectCtx = getProjectContext();
  const integrations = detectIntegrations();
  const configDir = internalPath();

  const [editors, gitCmd, credentials, session, credentialHelper] =
    await Promise.all([
      detectEditors(),
      resolveCommand("git").then((r) => r !== null),
      loadCredentials(),
      loadTokenSet(),
      inspectGitCredentialHelper(),
    ]);

  const editorMap = Object.fromEntries(editors.map((e) => [e.id, e.available]));

  // Cursor plugin is embedded in the VSIX — no project file to detect.
  // Use cursor CLI availability as a proxy (prerequisite for install).
  integrations.cursorPlugin = editorMap.cursor;

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
      session: sessionKind(session !== null, credentials !== null),
      credential_helper: credentialHelper,
    },
    project: {
      has_project: projectCtx.hasProject,
      adr_count: projectCtx.adrCount,
      adr_with_rules_count: projectCtx.adrWithRulesCount,
      domains: projectCtx.domains,
    },
    editors: {
      claude_cli: editorMap.claude,
      cursor_cli: editorMap.cursor,
      vscode_cli: editorMap.vscode,
      copilot_cli: editorMap.copilot,
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
