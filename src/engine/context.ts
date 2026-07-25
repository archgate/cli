// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { AdrDocument, AdrDomain } from "../formats/adr";
import {
  BRIEFED_SECTIONS,
  DEFAULT_MAX_SECTION_CHARS,
  extractAdrSections,
  truncateSection,
} from "./adr-sections";
import {
  getChangedFiles,
  getFilesChangedSinceRef,
  getStagedFiles,
} from "./git-files";
import { loadRuleAdrs, parseAllAdrs } from "./loader";
import type { ReportSummary } from "./reporter";
import { buildSummary, resultsWithFindings } from "./reporter";
import { runChecks } from "./runner";

interface AdrBriefing {
  id: string;
  title: string;
  domain: AdrDomain;
  files?: string[];
  rules: boolean;
  /** Present only when briefings are requested — see `briefAdr`. */
  decision?: string;
  /** Present only when briefings are requested — see `briefAdr`. */
  dosAndDonts?: string;
  /**
   * Section names whose prose was cut to fit `maxSectionChars`. Omitted when
   * nothing was cut, so its presence alone means context is missing and the
   * full ADR must be read via `archgate adr show <id>`.
   */
  truncatedSections?: string[];
}

interface DomainContext {
  domain: AdrDomain;
  changedFiles: string[];
  adrs: AdrBriefing[];
}

interface ReviewContext {
  allChangedFiles: string[];
  truncatedFiles: boolean;
  /**
   * IDs of ADRs whose briefing prose was cut, hoisted here so a consumer sees
   * that context is missing without walking every domain. Empty when nothing
   * was cut or when briefings were not requested.
   */
  truncatedBriefings: string[];
  domains: DomainContext[];
  checkSummary: ReportSummary | null;
}

interface BriefAdrOptions {
  /** Max chars per section. 0 = unlimited. Default: 2000. */
  maxSectionChars?: number;
  /** Include Decision and Do's/Don'ts prose. Default: false (ARCH-003 §7). */
  briefings?: boolean;
}

/**
 * Identify an ADR, and — when `briefings` is set — include its Decision and
 * Do's/Don'ts prose. The prose dominates review-context payload size, so it
 * is opt-in (ARCH-003 §7): the default identifies applicable ADRs and the
 * consumer drills in via `archgate adr show <id>`.
 */
export function briefAdr(
  adr: AdrDocument,
  options?: BriefAdrOptions
): AdrBriefing {
  const id = adr.frontmatter.id;
  const briefing: AdrBriefing = {
    id,
    title: adr.frontmatter.title,
    domain: adr.frontmatter.domain,
    files: adr.frontmatter.files,
    rules: adr.frontmatter.rules,
  };

  if (!options?.briefings) return briefing;

  const maxChars = options?.maxSectionChars ?? DEFAULT_MAX_SECTION_CHARS;
  const sections = extractAdrSections(adr.body, BRIEFED_SECTIONS);
  const decision = truncateSection(sections["Decision"], id, maxChars);
  const dosAndDonts = truncateSection(
    sections["Do's and Don'ts"],
    id,
    maxChars
  );
  briefing.decision = decision.text;
  briefing.dosAndDonts = dosAndDonts.text;

  const truncatedSections: string[] = [];
  if (decision.truncated) truncatedSections.push("Decision");
  if (dosAndDonts.truncated) truncatedSections.push("Do's and Don'ts");
  if (truncatedSections.length > 0) {
    briefing.truncatedSections = truncatedSections;
  }
  return briefing;
}

/** Cache compiled Bun.Glob instances — same patterns repeat across ADRs and files. */
const globCache = new Map<string, Bun.Glob>();

function fileMatchesGlobs(filePath: string, globs: string[]): boolean {
  for (const pattern of globs) {
    let glob = globCache.get(pattern);
    if (!glob) {
      glob = new Bun.Glob(pattern);
      globCache.set(pattern, glob);
    }
    // oxlint-disable-next-line prefer-regexp-test -- Bun.Glob.match() returns boolean, not RegExp
    if (glob.match(filePath)) return true;
  }
  return false;
}

/** Match changed files against ADR files globs, group by domain. */
export function matchFilesToAdrs(
  changedFiles: string[],
  allAdrs: AdrDocument[],
  options?: BriefAdrOptions
): DomainContext[] {
  const domainMap = new Map<
    AdrDomain,
    { files: Set<string>; adrs: Map<string, AdrBriefing> }
  >();

  for (const adr of allAdrs) {
    const domain = adr.frontmatter.domain;
    if (!domainMap.has(domain)) {
      domainMap.set(domain, { files: new Set(), adrs: new Map() });
    }
    const ctx = domainMap.get(domain)!;

    const matchingFiles: string[] = [];
    if (adr.frontmatter.files && adr.frontmatter.files.length > 0) {
      for (const file of changedFiles) {
        if (fileMatchesGlobs(file, adr.frontmatter.files)) {
          matchingFiles.push(file);
        }
      }
    } else {
      for (const f of changedFiles) matchingFiles.push(f);
    }

    if (matchingFiles.length > 0) {
      // Brief only ADRs that actually matched — briefAdr parses ADR sections
      // when briefings are requested, and doing that for non-matching ADRs is waste.
      ctx.adrs.set(adr.frontmatter.id, briefAdr(adr, options));
      for (const file of matchingFiles) ctx.files.add(file);
    }
  }

  const results: DomainContext[] = [];
  for (const [domain, ctx] of domainMap) {
    if (ctx.adrs.size > 0) {
      results.push({
        domain,
        changedFiles: [...ctx.files].sort(),
        adrs: [...ctx.adrs.values()],
      });
    }
  }
  return results.sort((a, b) => a.domain.localeCompare(b.domain));
}

/**
 * Load all ADR documents (not just those with rules) from the project.
 * Shares the per-process parse cache with `loadRuleAdrs` so
 * `review-context --run-checks` only reads the ADR directory once.
 */
async function loadAllAdrs(projectRoot: string): Promise<AdrDocument[]> {
  const parsed = await parseAllAdrs(projectRoot);
  return parsed.map((e) => e.adr);
}

const EMPTY_SUMMARY: ReportSummary = {
  pass: true,
  total: 0,
  passed: 0,
  failed: 0,
  warnings: 0,
  errors: 0,
  infos: 0,
  ruleErrors: 0,
  warningsExceeded: false,
  truncated: false,
  suppressed: 0,
  suppressionWarnings: [],
  briefingWarnings: [],
  results: [],
  durationMs: 0,
};

interface BuildReviewContextOptions {
  runChecks?: boolean;
  staged?: boolean;
  base?: string;
  domain?: AdrDomain;
  maxChangedFiles?: number;
  maxSectionChars?: number;
  maxViolationsPerRule?: number;
  /** Include Decision and Do's/Don'ts prose per ADR. Default: false. */
  briefings?: boolean;
}

/** Build a complete pre-computed review context with token-safe defaults. */
export async function buildReviewContext(
  projectRoot: string,
  options?: BuildReviewContextOptions
): Promise<ReviewContext> {
  const staged = options?.staged ?? false;
  const maxFiles = options?.maxChangedFiles ?? 200;
  const maxSectionChars = options?.maxSectionChars ?? DEFAULT_MAX_SECTION_CHARS;
  const maxViolationsPerRule = options?.maxViolationsPerRule ?? 20;

  const base = options?.base;
  const rawChangedFiles = staged
    ? await getStagedFiles(projectRoot)
    : base
      ? await getFilesChangedSinceRef(projectRoot, base)
      : await getChangedFiles(projectRoot);

  const truncatedFiles = maxFiles > 0 && rawChangedFiles.length > maxFiles;
  const allChangedFiles = truncatedFiles
    ? rawChangedFiles.slice(0, maxFiles)
    : rawChangedFiles;
  const allAdrs = await loadAllAdrs(projectRoot);
  let domains = matchFilesToAdrs(allChangedFiles, allAdrs, {
    maxSectionChars,
    briefings: options?.briefings,
  });
  if (options?.domain)
    domains = domains.filter((d) => d.domain === options.domain);

  let checkSummary: ReportSummary | null = null;
  if (options?.runChecks) {
    const loadResults = await loadRuleAdrs(projectRoot);
    if (loadResults.length > 0) {
      const checkResult = await runChecks(projectRoot, loadResults, {
        staged,
        base,
      });
      const summary = buildSummary(checkResult, { maxViolationsPerRule });
      // Same projection reportJSON applies: a cleanly-passing rule's entry only
      // restates static ADR text (11KB of 43 entries here), and the counts above
      // it already say how many passed. resultsWithFindings keeps warning-only
      // rules, which are status "pass" with violations.
      checkSummary = {
        ...summary,
        results: resultsWithFindings(summary.results),
      };
    } else {
      checkSummary = { ...EMPTY_SUMMARY };
    }
  }

  // Collected after domain filtering so the list names only ADRs the caller
  // actually received.
  const truncatedBriefings = domains
    .flatMap((d) => d.adrs)
    .filter((a) => a.truncatedSections !== undefined)
    .map((a) => a.id)
    .sort();

  return {
    allChangedFiles,
    truncatedFiles,
    truncatedBriefings,
    domains,
    checkSummary,
  };
}
