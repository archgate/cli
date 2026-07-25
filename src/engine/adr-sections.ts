// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { AdrDocument } from "../formats/adr";

/**
 * Sections `review-context --verbose` embeds in an ADR briefing. Prose in any
 * other section is never sent to a consumer, so only these two are capped.
 */
export const BRIEFED_SECTIONS = ["Decision", "Do's and Don'ts"] as const;

/** Max chars per briefed section before truncation. 0 = unlimited. */
export const DEFAULT_MAX_SECTION_CHARS = 2000;

/**
 * Extract named `##` sections from ADR markdown body.
 * Missing sections map to empty strings. Matching is case-insensitive.
 */
export function extractAdrSections(
  body: string,
  sectionNames: readonly string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of sectionNames) result[name] = "";

  const lines = body.split("\n");
  let currentSection: string | null = null;
  const sectionLines: string[] = [];

  const flushSection = () => {
    if (currentSection !== null) {
      const lowerName = currentSection.toLowerCase();
      for (const name of sectionNames) {
        if (name.toLowerCase() === lowerName) {
          result[name] = sectionLines.join("\n").trim();
          break;
        }
      }
    }
    sectionLines.length = 0;
  };

  for (const line of lines) {
    const headingMatch = line.match(/^## (.+)$/u);
    if (headingMatch) {
      flushSection();
      currentSection = headingMatch[1].trim();
      continue;
    }
    sectionLines.push(line);
  }
  flushSection();
  return result;
}

/** Truncate content to maxChars, appending a pointer to the full ADR. */
export function truncateSection(
  content: string,
  adrId: string,
  maxChars: number
): { text: string; truncated: boolean } {
  if (maxChars <= 0 || content.length <= maxChars) {
    return { text: content, truncated: false };
  }
  return {
    text: `${content.slice(0, maxChars)}\n\n[... truncated — read full ADR via adr://${adrId}]`,
    truncated: true,
  };
}

export interface BriefingBudgetWarning {
  adrId: string;
  /** Project-relative path of the ADR file. */
  file: string;
  /** Which briefed section overflows, e.g. "Decision". */
  section: string;
  length: number;
  cap: number;
}

/**
 * Report every briefed section that `briefAdr` would truncate.
 *
 * Prose past the cap never reaches the agent the ADR governs, and no companion
 * rule can detect that: rules measure code, not the ADR's own prose. Sharing
 * `extractAdrSections` with `briefAdr` is what keeps this aligned with the
 * truncation it predicts.
 *
 * @param adrs - Every ADR in the project, including `rules: false` ones.
 * @param maxChars - Cap per section; 0 disables the check entirely.
 */
export function collectBriefingBudgetWarnings(
  adrs: AdrDocument[],
  maxChars: number = DEFAULT_MAX_SECTION_CHARS
): BriefingBudgetWarning[] {
  if (maxChars <= 0) return [];

  const warnings: BriefingBudgetWarning[] = [];
  for (const adr of adrs) {
    const sections = extractAdrSections(adr.body, BRIEFED_SECTIONS);
    for (const section of BRIEFED_SECTIONS) {
      const length = sections[section].length;
      if (length > maxChars) {
        warnings.push({
          adrId: adr.frontmatter.id,
          file: adr.filePath,
          section,
          length,
          cap: maxChars,
        });
      }
    }
  }
  return warnings;
}
