// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { existsSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { parseAdr } from "../formats/adr";
import { ImportsManifestSchema, type ImportsManifest } from "../formats/pack";
import { getNextId, slugify } from "./adr-writer";
import { logDebug } from "./log";
import {
  resolveSource,
  shallowClone,
  detectTarget,
  type ImportTarget,
} from "./registry";

// ---------- Types ----------

export interface ResolvedImport {
  source: string;
  target: ImportTarget;
  cloneDir: string;
}

export interface AdrToImport {
  sourcePath: string;
  rulesPath: string | null;
  originalId: string;
  title: string;
  domain?: string;
  source: string;
  packVersion?: string;
}

export interface IdMapping {
  original: string;
  newId: string;
  title: string;
}

// ---------- Imports manifest I/O ----------

export async function loadImportsManifest(
  projectRoot: string
): Promise<ImportsManifest> {
  const importsPath = join(projectRoot, ".archgate", "imports.json");
  if (!existsSync(importsPath)) return { imports: [] };
  const raw = await Bun.file(importsPath).json();
  const result = ImportsManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid imports manifest at ${importsPath}: ${result.error.issues.map((i) => i.message).join(", ")}`
    );
  }
  return result.data;
}

export function saveImportsManifest(
  projectRoot: string,
  manifest: ImportsManifest
): void {
  const importsPath = join(projectRoot, ".archgate", "imports.json");
  writeFileSync(importsPath, JSON.stringify(manifest, null, 2) + "\n");
}

// ---------- ID rewriting ----------

export function rewriteAdrId(
  content: string,
  _oldId: string,
  newId: string
): string {
  // Replace id in frontmatter YAML only (between --- delimiters).
  // We extract the frontmatter block, replace the id line, and reconstruct.
  const fmRegex = /^(---\r?\n)([\s\S]*?\r?\n)(---)/mu;
  const match = content.match(fmRegex);
  if (!match) return content;

  const [fullMatch, openDelim, fmBody, closeDelim] = match;
  const updatedFm = fmBody.replace(/^(id:\s*).*$/mu, `$1${newId}`);
  return content.replace(fullMatch, `${openDelim}${updatedFm}${closeDelim}`);
}

// ---------- Source resolution & cloning ----------

/**
 * Resolve and clone all sources. Uses a cache to avoid re-cloning the same repo.
 * Sequential because clone N may share a repo with clone N+1 (dedup).
 */
export async function resolveAndCloneSources(
  sources: string[]
): Promise<{ resolved: ResolvedImport[]; tempDirs: string[] }> {
  const tempDirs: string[] = [];
  const resolved: ResolvedImport[] = [];
  const cloneCache = new Map<string, string>();

  try {
    for (const source of sources) {
      const res = resolveSource(source);
      logDebug("Resolved source:", JSON.stringify(res));

      const cacheKey = `${res.repoUrl}#${res.ref ?? ""}`;
      let cloneDir = cloneCache.get(cacheKey);

      if (!cloneDir) {
        cloneDir = await shallowClone(res.repoUrl, res.ref); // eslint-disable-line no-await-in-loop -- sequential by design (dedup)
        cloneCache.set(cacheKey, cloneDir);
        tempDirs.push(cloneDir);
      }

      const target = await detectTarget(cloneDir, res.subpath, res.kind); // eslint-disable-line no-await-in-loop -- depends on prior clone
      resolved.push({ source, target, cloneDir });
    }
  } catch (err) {
    cleanupTempDirs(tempDirs);
    throw err;
  }

  return { resolved, tempDirs };
}

// ---------- ADR collection ----------

/**
 * Read all ADR files from resolved targets and build the import list.
 */
export async function collectAdrsToImport(
  resolved: ResolvedImport[]
): Promise<AdrToImport[]> {
  const readPromises: Array<Promise<AdrToImport[]>> = resolved.map(
    async ({ source, target }) => {
      const items: AdrToImport[] = [];
      if (target.kind === "pack") {
        const contents = await Promise.all(
          target.adrFiles.map((f) => Bun.file(f).text())
        );
        for (let i = 0; i < target.adrFiles.length; i++) {
          const adrFile = target.adrFiles[i];
          const content = contents[i];
          const adr = parseAdr(content, adrFile);
          const adrBase = basename(adrFile, ".md");
          const rulesFile = target.rulesFiles.find(
            (r) => basename(r, ".rules.ts") === adrBase
          );
          items.push({
            sourcePath: adrFile,
            rulesPath: rulesFile ?? null,
            originalId: adr.frontmatter.id,
            title: adr.frontmatter.title,
            domain: adr.frontmatter.domain,
            source,
            packVersion: target.packMeta.version,
          });
        }
      } else {
        const content = await Bun.file(target.adrFile).text();
        const adr = parseAdr(content, target.adrFile);
        items.push({
          sourcePath: target.adrFile,
          rulesPath: target.rulesFile,
          originalId: adr.frontmatter.id,
          title: adr.frontmatter.title,
          domain: adr.frontmatter.domain,
          source,
        });
      }
      return items;
    }
  );

  const results = await Promise.all(readPromises);
  return results.flat();
}

// ---------- ID remapping ----------

/**
 * Build an ID mapping for imported ADRs, assigning new IDs based on domain prefixes.
 */
export function buildIdMap(
  adrsToImport: AdrToImport[],
  adrsDir: string,
  domainPrefixes: Record<string, string>
): IdMapping[] {
  const nextIdByPrefix = new Map<string, string>();
  const idMap: IdMapping[] = [];

  for (const adr of adrsToImport) {
    const prefix = (adr.domain && domainPrefixes[adr.domain]) || "ARCH";

    if (!nextIdByPrefix.has(prefix)) {
      nextIdByPrefix.set(prefix, getNextId(adrsDir, prefix));
    }

    const nextId = nextIdByPrefix.get(prefix)!;
    idMap.push({ original: adr.originalId, newId: nextId, title: adr.title });

    const num = parseInt(nextId.replace(`${prefix}-`, ""), 10) + 1;
    nextIdByPrefix.set(prefix, `${prefix}-${String(num).padStart(3, "0")}`);
  }

  return idMap;
}

// ---------- File writing ----------

/**
 * Write imported ADR files to disk with remapped IDs.
 * Returns list of written file paths for rollback on failure.
 */
export async function writeImportedAdrs(
  adrsToImport: AdrToImport[],
  idMap: IdMapping[],
  adrsDir: string
): Promise<string[]> {
  const writtenFiles: string[] = [];

  // Read all source files in parallel first
  const readTasks = adrsToImport.map((adr) => Bun.file(adr.sourcePath).text());
  const ruleTasks = adrsToImport.map((adr) =>
    adr.rulesPath ? Bun.file(adr.rulesPath).text() : Promise.resolve(null)
  );
  const [contents, rulesContents] = await Promise.all([
    Promise.all(readTasks),
    Promise.all(ruleTasks),
  ]);

  try {
    for (let i = 0; i < adrsToImport.length; i++) {
      const adr = adrsToImport[i];
      const mapping = idMap[i];
      const slug = slugify(mapping.title);
      const newFileName = `${mapping.newId}-${slug}.md`;
      const destPath = join(adrsDir, newFileName);

      const rewritten = rewriteAdrId(
        contents[i],
        adr.originalId,
        mapping.newId
      );
      writeFileSync(destPath, rewritten);
      writtenFiles.push(destPath);

      if (rulesContents[i] !== null) {
        const rulesFileName = `${mapping.newId}-${slug}.rules.ts`;
        const rulesDestPath = join(adrsDir, rulesFileName);
        writeFileSync(rulesDestPath, rulesContents[i]!);
        writtenFiles.push(rulesDestPath);
      }
    }
  } catch (err) {
    // Rollback: delete all written files
    for (const file of writtenFiles) {
      try {
        unlinkSync(file);
      } catch {
        // Best effort
      }
    }
    throw err;
  }

  return writtenFiles;
}

// ---------- Manifest update ----------

/**
 * Update the imports manifest with newly imported ADRs.
 */
export function updateImportsManifest(
  manifest: ImportsManifest,
  adrsToImport: AdrToImport[],
  idMap: IdMapping[]
): void {
  const sourceGroups = new Map<string, { version?: string; ids: string[] }>();

  for (let i = 0; i < adrsToImport.length; i++) {
    const adr = adrsToImport[i];
    const mapping = idMap[i];
    const existing = sourceGroups.get(adr.source);
    if (existing) {
      existing.ids.push(mapping.newId);
    } else {
      sourceGroups.set(adr.source, {
        version: adr.packVersion,
        ids: [mapping.newId],
      });
    }
  }

  for (const [source, group] of sourceGroups) {
    manifest.imports.push({
      source,
      version: group.version,
      importedAt: new Date().toISOString(),
      adrIds: group.ids,
    });
  }
}

// ---------- Cleanup ----------

export function cleanupTempDirs(dirs: string[]): void {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      logDebug("Failed to clean up temp dir:", dir);
    }
  }
}
