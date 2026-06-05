// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Cursor editor integration.
 *
 * Cursor has evolved from an IDE to an agent platform — users primarily
 * use `cursor agent` (CLI) and cloud agents. Archgate components (skills,
 * agents, hooks) are installed directly into Cursor's discovery
 * directories (`~/.cursor/{skills,agents}/`) via an authenticated
 * tarball download, bypassing Cursor's plugin subsystem which is
 * unreliable in CLI mode and absent in cloud environments.
 *
 * `configureCursorSettings` writes a project-level hooks file
 * (`.cursor/hooks.json`) for cloud agent compatibility — cloud VMs
 * have no `~/.cursor/` user config.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { logDebug } from "./log";

/**
 * Configure project-level Cursor settings for archgate integration.
 *
 * Writes hooks that cloud agents and local `cursor agent` can discover
 * from the project:
 *   - `.cursor/hooks.json` — afterFileEdit hook for archgate check
 *
 * @returns Path to the `.cursor/` directory (for init summary display).
 */
export function configureCursorSettings(projectRoot: string): string {
  const cursorDir = join(projectRoot, ".cursor");
  mkdirSync(cursorDir, { recursive: true });

  // Write hooks.json
  const hooksPath = join(cursorDir, "hooks.json");
  if (!existsSync(hooksPath)) {
    writeFileSync(
      hooksPath,
      JSON.stringify(HOOKS_JSON, null, 2) + "\n",
      "utf-8"
    );
    logDebug("Wrote Cursor hooks:", hooksPath);
  }

  return cursorDir;
}

const HOOKS_JSON = [
  {
    event: "afterFileEdit",
    type: "command",
    command: "archgate check ${filePath} --json 2>/dev/null || true",
  },
];
