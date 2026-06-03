// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Cursor editor integration.
 *
 * The archgate Cursor plugin is installed to the user-scope local plugins
 * directory (`~/.cursor/plugins/local/archgate/`). Cursor automatically
 * discovers plugins from this directory — no project-level files are needed.
 *
 * `configureCursorSettings` returns the resolved user-scope plugins
 * directory so the init summary has something meaningful to print (matching
 * the opencode pattern where user-scope paths replace project-tree paths).
 */

import { cursorPluginsLocalDir } from "./paths";

/**
 * Configure Cursor settings for archgate integration.
 *
 * No project-level files are written — the Cursor plugin is delivered to
 * the user-scope `~/.cursor/plugins/local/` directory by
 * `installCursorPlugin()`. Returns the resolved local plugins directory
 * path for the init summary display.
 *
 * @returns Path to the `~/.cursor/plugins/local/` directory.
 */
export function configureCursorSettings(): string {
  return cursorPluginsLocalDir();
}
