// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { styleText } from "node:util";

import type { Severity } from "../formats/rules";
import { formatJSON } from "../helpers/output";
import type { CheckResult } from "./runner";

export interface ReportSummary {
  pass: boolean;
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  errors: number;
  infos: number;
  ruleErrors: number;
  truncated: boolean;
  results: Array<{
    adrId: string;
    ruleId: string;
    description: string;
    status: "pass" | "fail" | "error";
    totalViolations: number;
    shownViolations: number;
    violations: Array<{
      message: string;
      file?: string;
      line?: number;
      endLine?: number;
      endColumn?: number;
      fix?: string;
      severity: Severity;
    }>;
    error?: string;
    durationMs: number;
  }>;
  durationMs: number;
}

interface BuildSummaryOptions {
  /** Maximum violations per rule. When exceeded, only the first N are kept. Omit or 0 for unlimited. */
  maxViolationsPerRule?: number;
}

export function buildSummary(
  result: CheckResult,
  options?: BuildSummaryOptions
): ReportSummary {
  const maxPerRule = options?.maxViolationsPerRule ?? 0;

  let passed = 0;
  let failed = 0;
  let warnings = 0;
  let errors = 0;
  let infos = 0;
  let ruleErrors = 0;
  let anyTruncated = false;

  const results = result.results.map((r) => {
    const hasErrors = r.violations.some((v) => v.severity === "error");
    const status: "pass" | "fail" | "error" = r.error
      ? "error"
      : hasErrors
        ? "fail"
        : "pass";

    if (r.error) ruleErrors++;
    else if (hasErrors) failed++;
    else passed++;

    // Count ALL violations for accurate totals (before capping)
    for (const v of r.violations) {
      if (v.severity === "error") errors++;
      else if (v.severity === "warning") warnings++;
      else infos++;
    }

    const totalViolations = r.violations.length;
    const capped =
      maxPerRule > 0 && totalViolations > maxPerRule
        ? r.violations.slice(0, maxPerRule)
        : r.violations;

    if (capped.length < totalViolations) anyTruncated = true;

    return {
      adrId: r.adrId,
      ruleId: r.ruleId,
      description: r.description,
      status,
      totalViolations,
      shownViolations: capped.length,
      violations: capped.map((v) => ({
        message: v.message,
        file: v.file,
        line: v.line,
        endLine: v.endLine,
        endColumn: v.endColumn,
        fix: v.fix,
        severity: v.severity,
      })),
      error: r.error,
      durationMs: r.durationMs,
    };
  });

  return {
    pass: failed === 0 && ruleErrors === 0,
    total: result.results.length,
    passed,
    failed,
    warnings,
    errors,
    infos,
    ruleErrors,
    truncated: anyTruncated,
    results,
    durationMs: result.totalDurationMs,
  };
}

/**
 * Output results in console format with colors.
 * Accepts an optional pre-built summary to avoid walking the results twice
 * when the caller already computed one (e.g. for telemetry).
 */
export function reportConsole(
  result: CheckResult,
  verbose: boolean,
  summary: ReportSummary = buildSummary(result)
): void {
  for (const r of summary.results) {
    const prefix = `${r.adrId}/${r.ruleId}`;

    if (r.status === "error") {
      console.log(
        styleText("red", `  x ${prefix}`),
        styleText("dim", r.description)
      );
      console.log(styleText("red", `    Rule error: ${r.error}`));
    } else if (r.status === "fail") {
      console.log(
        styleText("red", `  x ${prefix}`),
        styleText("dim", r.description)
      );
    } else if (verbose) {
      console.log(
        styleText("green", `  + ${prefix}`),
        styleText("dim", r.description)
      );
    }

    // Print violations
    for (const v of r.violations) {
      const loc = v.file ? (v.line ? `${v.file}:${v.line}` : v.file) : "";
      const sevColor =
        v.severity === "error"
          ? "red"
          : v.severity === "warning"
            ? "yellow"
            : "dim";

      const sevLabel =
        v.severity === "error"
          ? "error"
          : v.severity === "warning"
            ? "warn"
            : "info";

      console.log(
        `    ${styleText(sevColor as "red", `[${sevLabel}]`)} ${v.message}${loc ? ` ${styleText("dim", loc)}` : ""}`
      );

      if (v.fix && verbose) {
        console.log(styleText("dim", `           fix: ${v.fix}`));
      }
    }
  }

  // Summary line
  console.log();
  const parts: string[] = [];
  if (summary.passed > 0)
    parts.push(styleText("green", `${summary.passed} passed`));
  if (summary.failed > 0)
    parts.push(styleText("red", `${summary.failed} failed`));
  if (summary.ruleErrors > 0)
    parts.push(styleText("red", `${summary.ruleErrors} errors`));
  if (summary.warnings > 0)
    parts.push(styleText("yellow", `${summary.warnings} warnings`));

  const durationStr = styleText("dim", `(${summary.durationMs.toFixed(0)}ms)`);
  const status = summary.pass
    ? styleText("green", "check passed")
    : styleText("red", "check failed");

  console.log(`  ${status} - ${parts.join(", ")} ${durationStr}`);

  if (verbose) {
    const timeDetails = summary.results
      .map((r) => `    ${r.adrId}/${r.ruleId}: ${r.durationMs.toFixed(0)}ms`)
      .join("\n");
    console.log(styleText("dim", `\n  Timing:\n${timeDetails}`));
  }
}

/**
 * Output results as JSON.
 * @param forcePretty - When true, always pretty-print (e.g., explicit --json flag).
 *                      When omitted, format is auto-detected based on TTY/CI context.
 */
export function reportJSON(
  result: CheckResult,
  forcePretty?: boolean,
  summary: ReportSummary = buildSummary(result)
): void {
  console.log(formatJSON(summary, forcePretty));
}

/**
 * Output results as GitHub Actions annotations.
 */
export function reportCI(
  result: CheckResult,
  summary: ReportSummary = buildSummary(result)
): void {
  for (const r of summary.results) {
    if (r.error) {
      console.log(
        `::error title=${r.adrId}/${r.ruleId}::Rule execution error: ${r.error}`
      );
    }

    for (const v of r.violations) {
      const level =
        v.severity === "error"
          ? "error"
          : v.severity === "warning"
            ? "warning"
            : "notice";
      const filePart = v.file ? ` file=${v.file}` : "";
      const linePart = v.line ? `,line=${v.line}` : "";
      console.log(
        `::${level}${filePart}${linePart} title=${r.adrId}/${r.ruleId}::${v.message}`
      );
    }
  }

  // Also output summary
  const status = summary.pass ? "check passed" : "check failed";
  console.log(
    `\n${status}: ${summary.passed} passed, ${summary.failed} failed, ${summary.warnings} warnings`
  );
}

/**
 * Determine the exit code from check results.
 * 0 = pass, 1 = violations, 2 = rule execution errors.
 *
 * Prefer calling this with a pre-built summary — `check.ts` already computes
 * one for telemetry, and walking `result.results` a second time here is pure
 * duplication.
 */
export function getExitCode(
  result: CheckResult,
  summary?: ReportSummary
): number {
  if (summary) {
    if (summary.ruleErrors > 0) return 2;
    if (summary.failed > 0) return 1;
    return 0;
  }
  const hasErrors = result.results.some((r) => r.error);
  if (hasErrors) return 2;

  const hasViolations = result.results.some((r) =>
    r.violations.some((v) => v.severity === "error")
  );
  if (hasViolations) return 1;

  return 0;
}
