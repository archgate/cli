import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Content for .cursor/rules/archgate-governance.mdc.
 * Uses alwaysApply: true so the agent always has governance context.
 */
export const ARCHGATE_CURSOR_RULE = `---
description: Archgate ADR governance — enforces architecture decision records
globs:
alwaysApply: true
---

# Archgate Governance

This project uses Archgate to enforce Architecture Decision Records (ADRs).

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

## Key principle

Architectural decisions are enforced, not suggested. If \`archgate check\` reports violations, they must be fixed.
`;

/**
 * Configure Cursor settings for archgate integration.
 *
 * Writes `.cursor/rules/archgate-governance.mdc` with always-on governance rule.
 *
 * @returns Absolute path to the rules file.
 */
export async function configureCursorSettings(
  projectRoot: string
): Promise<string> {
  const cursorDir = join(projectRoot, ".cursor");
  const rulesDir = join(cursorDir, "rules");
  const rulePath = join(rulesDir, "archgate-governance.mdc");

  // Ensure directories exist
  if (!existsSync(cursorDir)) {
    mkdirSync(cursorDir, { recursive: true });
  }
  if (!existsSync(rulesDir)) {
    mkdirSync(rulesDir, { recursive: true });
  }

  await Bun.write(rulePath, ARCHGATE_CURSOR_RULE);

  return rulePath;
}
