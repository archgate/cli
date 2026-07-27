// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { resolve } from "node:path";

import type { ViolationDetail } from "../formats/rules";
import { logDebug } from "../helpers/log";
import type { RuleResult } from "./runner";

// --- Types ---

export interface SuppressionComment {
  type: "next-line" | "file";
  adrId: string;
  ruleId: string;
  reason: string | null;
  /** 1-based line number of the comment itself. */
  line: number;
  /**
   * 1-based line this next-line suppression targets.
   * For stacked comments, all suppressions in a consecutive block share the
   * same target: the first non-suppression line after the block.
   * Undefined for file-level suppressions.
   */
  targetLine?: number;
  file: string;
  /** Mutable — set to true when a violation matches this suppression. */
  matched: boolean;
}

export interface SuppressionWarning {
  message: string;
  file: string;
  line: number;
}

export interface SuppressionResult {
  /** Set of violations that were NOT suppressed (remain active). */
  activeViolations: Set<ViolationDetail>;
  suppressedCount: number;
  warnings: SuppressionWarning[];
}

// --- Parsing ---

/**
 * Matches `//` and `#` style suppression comments, e.g.
 * `# archgate-ignore ARCH-006/no-unapproved-deps legacy dep` or the
 * `archgate-ignore-file` variant. Capture groups: 1 = "-file" scope or
 * undefined, 2 = ADR ID, 3 = rule ID, 4 = reason text or undefined.
 */
const SUPPRESSION_RE =
  /^[ \t]*(?:\/\/|#)\s*archgate-ignore(-file)?\s+([\w-]+)\/([\w-]+)(?:\s+(.+))?$/u;

/** Regex to detect fenced code block delimiters in markdown (``` or ~~~). */
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/u;

/**
 * Parse suppression comments from file content. In markdown files (.md, .mdx),
 * lines inside fenced code blocks are skipped so that documented examples of
 * `archgate-ignore` are not treated as real suppression directives.
 *
 * @returns One entry per matching comment line.
 */
export function parseSuppressions(
  content: string,
  filePath: string
): SuppressionComment[] {
  const lines = content.split("\n");
  const results: SuppressionComment[] = [];
  const isMarkdown = filePath.endsWith(".md") || filePath.endsWith(".mdx");
  let insideCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    if (isMarkdown && FENCE_RE.test(lines[i])) {
      insideCodeBlock = !insideCodeBlock;
      continue;
    }
    if (insideCodeBlock) continue;

    const match = SUPPRESSION_RE.exec(lines[i]);
    if (!match) continue;

    results.push({
      type: match[1] === "-file" ? "file" : "next-line",
      adrId: match[2],
      ruleId: match[3],
      // Group 4 (reason) is genuinely optional in SUPPRESSION_RE — TS's
      // RegExpExecArray typing doesn't model per-group optionality, so the
      // `?.` here is required at runtime despite the lint claiming it isn't.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      reason: match[4]?.trim() ?? null,
      line: i + 1,
      file: filePath,
      matched: false,
    });
  }

  // Compute target lines: consecutive next-line suppressions all target the
  // first non-suppression line after the block, so stacking comments works.
  const suppressionLineSet = new Set(
    results.filter((s) => s.type === "next-line").map((s) => s.line)
  );
  for (const s of results) {
    if (s.type !== "next-line") continue;
    let target = s.line + 1;
    while (suppressionLineSet.has(target)) target++;
    s.targetLine = target;
  }

  return results;
}

// --- Filtering ---

/**
 * Apply inline suppressions to rule results: a violation with `file`/`line`
 * is dropped when an `archgate-ignore` comment precedes that line or an
 * `archgate-ignore-file` comment appears anywhere in the file. A suppression
 * missing its reason suppresses nothing and warns once it is scope-matched;
 * an unused suppression that has a reason warns too.
 */
export async function applySuppressions(
  projectRoot: string,
  results: RuleResult[]
): Promise<SuppressionResult> {
  const filePathsNeeded = new Set<string>();
  for (const r of results) {
    for (const v of r.violations) {
      if (v.file !== undefined && v.file !== "") filePathsNeeded.add(v.file);
    }
  }

  if (filePathsNeeded.size === 0) {
    const allViolations = new Set<ViolationDetail>();
    for (const r of results) {
      for (const v of r.violations) allViolations.add(v);
    }
    return {
      activeViolations: allViolations,
      suppressedCount: 0,
      warnings: [],
    };
  }

  const fileSuppressions = new Map<string, SuppressionComment[]>();
  const readPromises = Array.from(filePathsNeeded, async (relPath) => {
    try {
      const absPath = resolve(projectRoot, relPath);
      const content = await Bun.file(absPath).text();
      const suppressions = parseSuppressions(content, relPath);
      if (suppressions.length > 0) {
        fileSuppressions.set(relPath, suppressions);
      }
    } catch {
      // File unreadable — skip, no suppressions for this file
      logDebug(`Suppression scan: could not read ${relPath}`);
    }
  });
  await Promise.all(readPromises);

  const activeViolations = new Set<ViolationDetail>();
  const warnings: SuppressionWarning[] = [];
  let suppressedCount = 0;

  for (const r of results) {
    for (const v of r.violations) {
      const suppressed = checkSuppression(v, fileSuppressions, warnings);
      if (suppressed) {
        suppressedCount++;
      } else {
        activeViolations.add(v);
      }
    }
  }

  for (const [, suppressions] of fileSuppressions) {
    for (const s of suppressions) {
      if (s.reason === null) continue; // already warned about missing reason
      if (!s.matched) {
        warnings.push({
          message: `Unused suppression: ${s.adrId}/${s.ruleId}`,
          file: s.file,
          line: s.line,
        });
      }
    }
  }

  logDebug(
    `Suppressions: ${suppressedCount} suppressed, ${warnings.length} warnings`
  );

  return { activeViolations, suppressedCount, warnings };
}

/**
 * Check whether a single violation is suppressed by any comment in its file.
 *
 * @returns True when a scope-matching suppression carries a reason. A
 * scope-matching suppression missing its reason pushes a warning and returns
 * false, so the violation still reports.
 */
function checkSuppression(
  violation: ViolationDetail,
  fileSuppressions: Map<string, SuppressionComment[]>,
  warnings: SuppressionWarning[]
): boolean {
  if (violation.file === undefined || violation.file === "") return false;

  const suppressions = fileSuppressions.get(violation.file);
  if (!suppressions) return false;

  const qualifiedId = `${violation.adrId}/${violation.ruleId}`;

  for (const s of suppressions) {
    if (s.adrId !== violation.adrId || s.ruleId !== violation.ruleId) continue;

    // Check scope match — targetLine accounts for stacked suppression blocks
    const scopeMatches =
      s.type === "file" ||
      (violation.line !== undefined && s.targetLine === violation.line);

    if (!scopeMatches) continue;

    // Reason is required — missing reason means the suppression is ignored
    if (s.reason === null) {
      warnings.push({
        message: `Suppression for ${qualifiedId} is missing a reason`,
        file: s.file,
        line: s.line,
      });
      return false;
    }

    s.matched = true;
    return true;
  }

  return false;
}
