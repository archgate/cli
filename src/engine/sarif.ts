// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Severity } from "../formats/rules";
import type { ReportSummary } from "./reporter";

/** Minimal SARIF 2.1.0 log — only the fields archgate actually populates. */
export interface SarifLog {
  $schema: "https://json.schemastore.org/sarif-2.1.0.json";
  version: "2.1.0";
  runs: SarifRun[];
}

export interface SarifRun {
  tool: { driver: SarifToolDriver };
  results: SarifResult[];
}

export interface SarifToolDriver {
  name: "archgate";
  rules: SarifRule[];
}

export interface SarifRule {
  id: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  help: { text: string };
}

export interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: SarifLocation[];
}

export interface SarifLocation {
  physicalLocation: { artifactLocation: { uri: string }; region?: SarifRegion };
}

export interface SarifRegion {
  startLine: number;
  endLine?: number;
}

/** Synthetic rule IDs for advisory findings that have no underlying rule. */
const BRIEFING_BUDGET_RULE_ID = "archgate/briefing-budget";
const SUPPRESSION_WARNING_RULE_ID = "archgate/suppression-warning";
const UNPARSED_ADR_RULE_ID = "archgate/unparsed-adr";

/** archgate `Severity` → SARIF `level`. */
function mapSeverity(severity: Severity): "error" | "warning" | "note" {
  if (severity === "error") return "error";
  if (severity === "warning") return "warning";
  return "note";
}

/**
 * Build a SARIF `location`. `region` is included only when `line` is known —
 * archgate violations carry no `startColumn` at all (only `endColumn` on
 * some), so columns are never emitted; lines-only matches what the console
 * and GitHub Actions reporters already surface (`file:line`, never columns).
 */
function buildLocation(
  file: string,
  line?: number,
  endLine?: number
): SarifLocation {
  const region: SarifRegion | undefined =
    line === undefined
      ? undefined
      : { startLine: line, ...(endLine !== undefined && { endLine }) };
  return {
    physicalLocation: {
      artifactLocation: { uri: file },
      ...(region && { region }),
    },
  };
}

/**
 * Build a SARIF 2.1.0 log from a check summary. Purely a new serialization
 * of the same `ReportSummary` every other reporter consumes — includes
 * ordinary rule violations plus the three advisory categories
 * (briefingWarnings, suppressionWarnings, unparsedAdrs) as synthetic-rule
 * results, since GitHub Code Scanning has no separate "advisory" severity.
 */
export function buildSarifLog(summary: ReportSummary): SarifLog {
  const rules = new Map<string, SarifRule>();
  const results: SarifResult[] = [];

  for (const r of summary.results) {
    const ruleId = `${r.adrId}/${r.ruleId}`;
    if (!rules.has(ruleId)) {
      rules.set(ruleId, {
        id: ruleId,
        shortDescription: { text: r.description },
        fullDescription: { text: r.description },
        help: {
          text: `See \`archgate adr show ${r.adrId}\` for the full ADR.`,
        },
      });
    }
    for (const v of r.violations) {
      results.push({
        ruleId,
        level: mapSeverity(v.severity),
        message: { text: v.message },
        locations:
          v.file !== undefined && v.file !== ""
            ? [buildLocation(v.file, v.line, v.endLine)]
            : [],
      });
    }
  }

  if (summary.suppressionWarnings.length > 0) {
    rules.set(SUPPRESSION_WARNING_RULE_ID, {
      id: SUPPRESSION_WARNING_RULE_ID,
      shortDescription: {
        text: "Suppression comment warning (missing reason or unused suppression)",
      },
      fullDescription: {
        text: "Suppression comment warning (missing reason or unused suppression)",
      },
      help: { text: "Review the archgate-ignore comment at this location." },
    });
    for (const w of summary.suppressionWarnings) {
      results.push({
        ruleId: SUPPRESSION_WARNING_RULE_ID,
        level: "warning",
        message: { text: w.message },
        locations: [buildLocation(w.file, w.line)],
      });
    }
  }

  if (summary.briefingWarnings.length > 0) {
    rules.set(BRIEFING_BUDGET_RULE_ID, {
      id: BRIEFING_BUDGET_RULE_ID,
      shortDescription: {
        text: "ADR section exceeds the review-context briefing budget",
      },
      fullDescription: {
        text: "ADR section exceeds the review-context briefing budget",
      },
      help: {
        text: "See the ADR's Decision/Do's and Don'ts sections, or run `archgate check` for the full diagnostic.",
      },
    });
    for (const w of summary.briefingWarnings) {
      results.push({
        ruleId: BRIEFING_BUDGET_RULE_ID,
        level: "warning",
        message: {
          text: `${w.adrId} "${w.section}" is ${w.length} chars; review-context truncates at ${w.cap}, hiding ${w.length - w.cap} from agent briefings`,
        },
        locations: [buildLocation(w.file)],
      });
    }
  }

  if (summary.unparsedAdrs.length > 0) {
    rules.set(UNPARSED_ADR_RULE_ID, {
      id: UNPARSED_ADR_RULE_ID,
      shortDescription: {
        text: "ADR file could not be parsed and was excluded from every check",
      },
      fullDescription: {
        text: "ADR file could not be parsed and was excluded from every check",
      },
      help: {
        text: "Fix the ADR's frontmatter/markdown so archgate can parse it.",
      },
    });
    for (const file of summary.unparsedAdrs) {
      results.push({
        ruleId: UNPARSED_ADR_RULE_ID,
        level: "warning",
        message: {
          text: "ADR could not be parsed and was excluded from every check",
        },
        locations: [buildLocation(file)],
      });
    }
  }

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "archgate", rules: [...rules.values()] } },
        results,
      },
    ],
  };
}
