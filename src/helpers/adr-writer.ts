import { existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

import {
  DOMAIN_PREFIXES,
  type AdrDomain,
  type AdrDocument,
  parseAdr,
} from "../formats/adr";
import { generateAdrTemplate } from "./adr-templates";
import { generateRulesTemplate } from "./rules-shim";

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

export function getNextId(adrsDir: string, prefix: string): string {
  if (!existsSync(adrsDir)) return `${prefix}-001`;

  const files = readdirSync(adrsDir).filter((f) => f.endsWith(".md"));
  let maxNum = 0;

  for (const file of files) {
    const match = file.match(new RegExp(`^${prefix}-(\\d+)`));
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }

  return `${prefix}-${String(maxNum + 1).padStart(3, "0")}`;
}

export function buildAdrContent(opts: {
  id: string;
  title: string;
  domain: AdrDomain;
  files?: string[];
  body?: string;
  rules?: boolean;
}): string {
  if (opts.body) {
    const filesLine = opts.files?.length
      ? `\nfiles: [${opts.files.map((f) => `"${f}"`).join(", ")}]`
      : "";
    const rulesValue = opts.rules ?? false;
    return `---
id: ${opts.id}
title: ${opts.title}
domain: ${opts.domain}
rules: ${rulesValue}${filesLine}
---

${opts.body}
`;
  }
  return generateAdrTemplate({
    id: opts.id,
    title: opts.title,
    domain: opts.domain,
    files: opts.files,
  });
}

export interface CreateAdrResult {
  id: string;
  fileName: string;
  filePath: string;
}

/**
 * Create an ADR file on disk.
 * `prefix` overrides the built-in DOMAIN_PREFIXES lookup — callers that
 * support custom domains should resolve it via `resolveDomainPrefix` from
 * `helpers/project-config` and pass it explicitly.
 */
export async function createAdrFile(
  adrsDir: string,
  opts: {
    title: string;
    domain: AdrDomain;
    prefix?: string;
    files?: string[];
    body?: string;
    rules?: boolean;
  }
): Promise<CreateAdrResult> {
  const prefix =
    opts.prefix ?? DOMAIN_PREFIXES[opts.domain as keyof typeof DOMAIN_PREFIXES];
  if (!prefix) {
    throw new Error(
      `No prefix registered for domain '${opts.domain}'. Pass opts.prefix or register via \`archgate domain add\`.`
    );
  }
  const id = getNextId(adrsDir, prefix);
  const slug = slugify(opts.title);
  const content = buildAdrContent({ id, ...opts });
  const fileName = `${id}-${slug}.md`;
  const filePath = join(adrsDir, fileName);
  await Bun.write(filePath, content);

  // Generate companion .rules.ts when rules are enabled
  if (opts.rules) {
    const rulesFileName = `${id}-${slug}.rules.ts`;
    const rulesFilePath = join(adrsDir, rulesFileName);
    await Bun.write(rulesFilePath, generateRulesTemplate());
  }

  return { id, fileName, filePath };
}

/**
 * Scan ADR markdown files and return the AdrDocument matching the given ID, or null.
 */
export async function findAdrFileById(
  adrsDir: string,
  id: string
): Promise<AdrDocument | null> {
  if (!existsSync(adrsDir)) return null;

  const files = readdirSync(adrsDir).filter((f) => f.endsWith(".md"));

  const results = await Promise.all(
    files.map(async (file) => {
      const filePath = join(adrsDir, file);
      try {
        const content = await Bun.file(filePath).text();
        return parseAdr(content, filePath);
      } catch {
        return null;
      }
    })
  );

  return results.find((adr) => adr?.frontmatter.id === id) ?? null;
}

export interface UpdateAdrResult {
  id: string;
  fileName: string;
  filePath: string;
}

/**
 * Update an existing ADR file on disk. Finds the ADR by ID, merges provided
 * frontmatter fields (preserving unset fields), replaces the body, and writes
 * back to the same file path. Throws if the ID is not found.
 */
export async function updateAdrFile(
  adrsDir: string,
  opts: {
    id: string;
    title?: string;
    domain?: AdrDomain;
    files?: string[];
    body: string;
    rules?: boolean;
  }
): Promise<UpdateAdrResult> {
  const existing = await findAdrFileById(adrsDir, opts.id);

  if (!existing) {
    throw new Error(`ADR ${opts.id} not found in ${adrsDir}`);
  }

  const fm = existing.frontmatter;
  const title = opts.title ?? fm.title;
  const domain = opts.domain ?? fm.domain;
  const rules = opts.rules ?? fm.rules;
  const files = opts.files ?? fm.files;

  const content = buildAdrContent({
    id: opts.id,
    title,
    domain,
    files,
    body: opts.body,
    rules,
  });

  const fileName = basename(existing.filePath);
  await Bun.write(existing.filePath, content);

  return { id: opts.id, fileName, filePath: existing.filePath };
}
