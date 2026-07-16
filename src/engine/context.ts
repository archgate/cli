// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { AdrDocument, AdrDomain } from "../formats/adr";
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
}

interface DomainContext {
  domain: AdrDomain;
  changedFiles: string[];
  adrs: AdrBriefing[];
}

interface ReviewContext {
  allChangedFiles: string[];
  truncatedFiles: boolean;
  domains: DomainContext[];
  checkSummary: ReportSummary | null;
}

/**
 * Extract named ## sections from ADR markdown body.
 * Missing sections map to empty strings. Matching is case-insensitive.
 */
export function extractAdrSections(
  body: string,
  sectionNames: string[]
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

interface BriefAdrOptions {
  /** Max chars per section. 0 = unlimited. Default: 2000. */
  maxSectionChars?: number;
  /** Include Decision and Do's/Don'ts prose. Default: false (ARCH-003 §7). */
  briefings?: boolean;
}

const DEFAULT_MAX_SECTION_CHARS = 2000;

/** Truncate content to maxChars, appending a pointer to the full ADR. */
function truncateSection(
  content: string,
  adrId: string,
  maxChars: number
): string {
  if (maxChars <= 0 || content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n[... truncated — read full ADR via adr://${adrId}]`;
}

/**
 * Identify an ADR, and — when `briefings` is set — include its Decision and
 * Do's/Don'ts prose.
 *
 * That prose is ~78% of a review context on a repo of any size (62KB of 80KB
 * here) and grows with the number of matched ADRs, which pushes the payload past
 * the point where agent harnesses spill it to a file (ARCH-003 §7). It is
 * therefore opt-in: the default identifies which ADRs apply, and the consumer
 * drills into the ones it needs with `archgate adr show <id>`. Skipping the
 * prose also skips `extractAdrSections` entirely, so the lean path is cheaper.
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
  const sections = extractAdrSections(adr.body, [
    "Decision",
    "Do's and Don'ts",
  ]);
  briefing.decision = truncateSection(sections["Decision"], id, maxChars);
  briefing.dosAndDonts = truncateSection(
    sections["Do's and Don'ts"],
    id,
    maxChars
  );
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

  return { allChangedFiles, truncatedFiles, domains, checkSummary };
}
