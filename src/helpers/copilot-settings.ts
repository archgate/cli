// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Configure Copilot CLI settings for archgate integration.
 *
 * Creates the `.github/copilot/` directory if it does not exist.
 * Plugin installation is handled separately via `archgate init --install-plugin`.
 *
 * @returns Absolute path to the `.github/copilot/` directory.
 */
export function configureCopilotSettings(projectRoot: string): string {
  const copilotDir = join(projectRoot, ".github", "copilot");

  if (!existsSync(copilotDir)) {
    mkdirSync(copilotDir, { recursive: true });
  }

  return copilotDir;
}
