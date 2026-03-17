import { readdirSync } from "node:fs";
import { join } from "node:path";

import { parseAdr } from "../formats/adr";
import type { AdrDocument, AdrDomain } from "../formats/adr";
import { projectPaths } from "../helpers/paths";
import { getChangedFiles, getStagedFiles } from "./git-files";
import { loadRuleAdrs } from "./loader";
import type { ReportSummary } from "./reporter";
import { buildSummary } from "./reporter";
import { runChecks } from "./runner";

export interface AdrBriefing {
  id: string;
  title: string;
  domain: AdrDomain;
  files?: string[];
  rules: boolean;
  decision: string;
  dosAndDonts: string;
}

export interface DomainContext {
  domain: AdrDomain;
  changedFiles: string[];
  adrs: AdrBriefing[];
}

export interface ReviewContext {
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
    const headingMatch = line.match(/^## (.+)$/);
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

export interface BriefAdrOptions {
  /** Max chars per section. 0 = unlimited. Default: 2000. */
  maxSectionChars?: number;
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

/** Create a condensed briefing from a full AdrDocument (Decision + Do's/Don'ts). */
export function briefAdr(
  adr: AdrDocument,
  options?: BriefAdrOptions
): AdrBriefing {
  const maxChars = options?.maxSectionChars ?? DEFAULT_MAX_SECTION_CHARS;
  const sections = extractAdrSections(adr.body, [
    "Decision",
    "Do's and Don'ts",
  ]);
  const id = adr.frontmatter.id;
  return {
    id,
    title: adr.frontmatter.title,
    domain: adr.frontmatter.domain,
    files: adr.frontmatter.files,
    rules: adr.frontmatter.rules,
    decision: truncateSection(sections["Decision"], id, maxChars),
    dosAndDonts: truncateSection(sections["Do's and Don'ts"], id, maxChars),
  };
}

function fileMatchesGlobs(filePath: string, globs: string[]): boolean {
  for (const pattern of globs) {
    const glob = new Bun.Glob(pattern);
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
    const briefing = briefAdr(adr, options);

    const matchingFiles: string[] = [];
    if (adr.frontmatter.files && adr.frontmatter.files.length > 0) {
      for (const file of changedFiles) {
        if (fileMatchesGlobs(file, adr.frontmatter.files)) {
          matchingFiles.push(file);
        }
      }
    } else {
      matchingFiles.push(...changedFiles);
    }

    if (matchingFiles.length > 0) {
      ctx.adrs.set(adr.frontmatter.id, briefing);
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

/** Load all ADR documents (not just those with rules) from the project. */
async function loadAllAdrs(projectRoot: string): Promise<AdrDocument[]> {
  const pp = projectPaths(projectRoot);
  const adrs: AdrDocument[] = [];

  let files: string[];
  try {
    files = readdirSync(pp.adrsDir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }

  for (const file of files) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- sequential file discovery
      const content = await Bun.file(join(pp.adrsDir, file)).text();
      adrs.push(parseAdr(content, join(pp.adrsDir, file)));
    } catch {
      // Skip unparseable ADRs
    }
  }
  return adrs;
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
  truncated: false,
  results: [],
  durationMs: 0,
};

export interface BuildReviewContextOptions {
  runChecks?: boolean;
  staged?: boolean;
  domain?: AdrDomain;
  maxChangedFiles?: number;
  maxSectionChars?: number;
  maxViolationsPerRule?: number;
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

  const rawChangedFiles = staged
    ? await getStagedFiles(projectRoot)
    : await getChangedFiles(projectRoot);

  const truncatedFiles = maxFiles > 0 && rawChangedFiles.length > maxFiles;
  const allChangedFiles = truncatedFiles
    ? rawChangedFiles.slice(0, maxFiles)
    : rawChangedFiles;
  const allAdrs = await loadAllAdrs(projectRoot);
  let domains = matchFilesToAdrs(allChangedFiles, allAdrs, { maxSectionChars });
  if (options?.domain)
    domains = domains.filter((d) => d.domain === options.domain);

  let checkSummary: ReportSummary | null = null;
  if (options?.runChecks) {
    const loadedAdrs = await loadRuleAdrs(projectRoot);
    if (loadedAdrs.length > 0) {
      const checkResult = await runChecks(projectRoot, loadedAdrs, { staged });
      checkSummary = buildSummary(checkResult, { maxViolationsPerRule });
    } else {
      checkSummary = { ...EMPTY_SUMMARY };
    }
  }

  return { allChangedFiles, truncatedFiles, domains, checkSummary };
}
