// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Cursor editor integration.
 *
 * The archgate Cursor plugin (skills, agents, governance rules) is now
 * embedded inside the VS Code extension (.vsix). When the extension
 * activates in Cursor it calls `vscode.cursor.plugins.registerPath()`
 * to expose the plugin — no project-level files are needed.
 *
 * `configureCursorSettings` is kept as a no-op for call-site
 * compatibility (init-project.ts, etc.) and returns the `.cursor/`
 * directory path for the init summary output.
 */

import { join } from "node:path";

/**
 * Configure Cursor settings for archgate integration.
 *
 * No-op — the archgate VSIX extension embeds the Cursor plugin and
 * registers it via `vscode.cursor.plugins.registerPath()` at runtime.
 * No project-level files are written.
 *
 * @returns Path to the `.cursor/` directory (for init summary display).
 */
export function configureCursorSettings(projectRoot: string): string {
  return join(projectRoot, ".cursor");
}
