// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Cursor editor integration.
 *
 * Cursor has evolved from an IDE to an agent platform — users primarily
 * use `cursor agent` (CLI) and cloud agents. Archgate components (skills,
 * agents, rules, hooks) are installed directly into Cursor's discovery
 * directories (`~/.cursor/{skills,agents,rules}/`) via an authenticated
 * tarball download, bypassing Cursor's plugin subsystem which is
 * unreliable in CLI mode and absent in cloud environments.
 *
 * `configureCursorSettings` writes project-level governance files
 * (`.cursor/rules/` and `.cursor/hooks.json`) for cloud agent
 * compatibility — cloud VMs have no `~/.cursor/` user config.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { logDebug } from "./log";

/**
 * Configure project-level Cursor settings for archgate integration.
 *
 * Writes governance files that cloud agents and local `cursor agent` can
 * discover from the project:
 *   - `.cursor/rules/archgate-governance.mdc` — always-on governance rule
 *   - `.cursor/hooks.json` — afterFileEdit hook for archgate check
 *
 * @returns Path to the `.cursor/` directory (for init summary display).
 */
export function configureCursorSettings(projectRoot: string): string {
  const cursorDir = join(projectRoot, ".cursor");
  const rulesDir = join(cursorDir, "rules");
  mkdirSync(rulesDir, { recursive: true });

  // Write governance rule (.mdc)
  const rulePath = join(rulesDir, "archgate-governance.mdc");
  if (!existsSync(rulePath)) {
    writeFileSync(rulePath, GOVERNANCE_RULE, "utf-8");
    logDebug("Wrote Cursor governance rule:", rulePath);
  }

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

const GOVERNANCE_RULE = `---
description: Archgate ADR governance — enforces architecture decision records
globs:
alwaysApply: true
---

# Archgate Governance

This project uses Archgate to enforce Architecture Decision Records (ADRs). ADRs encode the team's architectural decisions so every contributor — human or AI — builds consistently.

## Key principle

Architectural decisions are enforced, not suggested. ADR violations are **hard blockers**.

## Before writing code

- Run \`archgate review-context\` to get applicable ADR briefings for changed files
- Review the Decision and Do's/Don'ts sections of each applicable ADR

## After writing code

- Run \`archgate check --staged\` to validate compliance with all ADR rules
- Fix any violations before considering work complete

## ADR commands

- \`archgate adr list\` — List all active ADRs with metadata
- \`archgate check --staged\` — Run automated compliance checks
- \`archgate review-context\` — Get changed files grouped by domain with ADR briefings

## CLI installation

If \`archgate\` is not installed: \`curl -fsSL https://cli.archgate.dev/install-unix | sh\`
`;

const HOOKS_JSON = [
  {
    event: "afterFileEdit",
    type: "command",
    command: "archgate check ${filePath} --json 2>/dev/null || true",
  },
];
