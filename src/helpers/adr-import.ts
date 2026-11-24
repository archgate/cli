// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import { scanImportedRuleSource } from "../engine/rule-scanner";
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
import { UserError } from "./user-error";

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
  const raw: unknown = await Bun.file(importsPath).json();
  const result = ImportsManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new UserError(
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
  const fmRegex = /^(---\r?\n)([\s\S]*?\r?\n)(---)/mu;
  const match = fmRegex.exec(content);
  if (!match) return content;

  const [fullMatch, openDelim, fmBody, closeDelim] = match;
  const updatedFm = fmBody.replace(/^(id:\s*).*$/mu, `$1${newId}`);
  return content.replace(fullMatch, `${openDelim}${updatedFm}${closeDelim}`);
}

// ---------- Source resolution & cloning ----------

/**
 * Caches clones so a repo shared by several sources is fetched once, and runs
 * sequentially because clone N may share a repo with clone N+1 (dedup).
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

      if (cloneDir === undefined) {
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

export async function collectAdrsToImport(
  resolved: ResolvedImport[]
): Promise<AdrToImport[]> {
  const readPromises: Array<Promise<AdrToImport[]>> = resolved.map(
    async ({ source, target }) => {
      const items: AdrToImport[] = [];
      if (target.kind === "pack") {
        const contents = await Promise.all(
          target.adrFiles.map(async (f) => Bun.file(f).text())
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

export function buildIdMap(
  adrsToImport: AdrToImport[],
  adrsDir: string,
  domainPrefixes: Record<string, string>
): IdMapping[] {
  const nextIdByPrefix = new Map<string, string>();
  const idMap: IdMapping[] = [];

  for (const adr of adrsToImport) {
    const domainPrefix =
      adr.domain !== undefined && adr.domain !== ""
        ? domainPrefixes[adr.domain]
        : undefined;
    const prefix = domainPrefix ?? "ARCH";

    if (!nextIdByPrefix.has(prefix)) {
      nextIdByPrefix.set(prefix, getNextId(adrsDir, prefix));
    }

    const nextId = nextIdByPrefix.get(prefix)!;
    idMap.push({ original: adr.originalId, newId: nextId, title: adr.title });

    const num = Math.trunc(Number(nextId.replace(`${prefix}-`, ""))) + 1;
    nextIdByPrefix.set(prefix, `${prefix}-${String(num).padStart(3, "0")}`);
  }

  return idMap;
}

// ---------- File writing ----------

/**
 * Write imported ADR files to disk with remapped IDs.
 *
 * @param adrsToImport - The ADRs to write, each with its source path and
 * optional companion rules path.
 * @param idMap - Old-to-new ID mapping applied to filenames and content.
 * @param adrsDir - Destination ADR directory.
 * @returns Every written file path, in write order, so a caller can roll
 * back the partial set when a later step fails.
 */
export async function writeImportedAdrs(
  adrsToImport: AdrToImport[],
  idMap: IdMapping[],
  adrsDir: string
): Promise<string[]> {
  const writtenFiles: string[] = [];

  const readTasks = adrsToImport.map(async (adr) =>
    Bun.file(adr.sourcePath).text()
  );
  const ruleTasks = adrsToImport.map(async (adr) =>
    adr.rulesPath !== null && adr.rulesPath !== ""
      ? Bun.file(adr.rulesPath).text()
      : null
  );
  const [contents, rulesContents] = await Promise.all([
    Promise.all(readTasks),
    Promise.all(ruleTasks),
  ]);

  // Security gate for third-party rule code: an imported `.rules.ts` is
  // arbitrary code `archgate check` will later execute in-process, so it is
  // scanned with the stricter imported-rule ruleset BEFORE it lands on disk —
  // once in `.archgate/adrs/` it is indistinguishable from a project-authored
  // rule (no provenance), and scanning pre-write leaves nothing to roll back.
  const scanFailures = adrsToImport.flatMap((adr, i) => {
    const ruleSource = rulesContents[i];
    if (ruleSource === null) return [];
    const violations = scanImportedRuleSource(ruleSource);
    if (violations.length === 0) return [];
    const details = violations
      .map((v) => `    ${v.line}:${v.column}  ${v.message}`)
      .join("\n");
    return [
      `  ${adr.originalId} (${basename(adr.rulesPath ?? "")}):\n${details}`,
    ];
  });

  if (scanFailures.length > 0) {
    throw new UserError(
      `Imported rule file(s) blocked by the security scanner:\n\n${scanFailures.join("\n\n")}\n\n` +
        "Imported rules run in-process during `archgate check`. Nothing was written. " +
        "Review the source, and import only rules you trust."
    );
  }

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

export function updateImportsManifest(
  manifest: ImportsManifest,
  adrsToImport: AdrToImport[],
  idMap: IdMapping[]
): void {
  const sourceGroups = new Map<
    string,
    { version?: string; ids: string[]; originalIds: Record<string, string> }
  >();

  for (let i = 0; i < adrsToImport.length; i++) {
    const adr = adrsToImport[i];
    const mapping = idMap[i];
    let group = sourceGroups.get(adr.source);
    if (!group) {
      group = { version: adr.packVersion, ids: [], originalIds: {} };
      sourceGroups.set(adr.source, group);
    }
    group.ids.push(mapping.newId);
    group.originalIds[mapping.newId] = adr.originalId;
  }

  for (const [source, group] of sourceGroups) {
    manifest.imports.push({
      source,
      version: group.version,
      importedAt: new Date().toISOString(),
      adrIds: group.ids,
      originalIds: group.originalIds,
    });
  }
}

// ---------- Selection filters ----------

export interface ImportFilter {
  only?: readonly string[];
  exclude?: readonly string[];
}

/**
 * Split variadic option values that may also be comma-separated
 * (`--exclude A B` and `--exclude A,B` are equivalent). An omitted option
 * yields `[]`; a supplied option holding no ID is a UserError, so
 * `--only ","` cannot fall through to importing the whole pack.
 */
export function parseIdList(
  values: readonly string[] | undefined,
  option: string
): string[] {
  if (values === undefined) return [];
  const ids = values
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  if (ids.length === 0) {
    throw new UserError(`${option} needs at least one ADR ID.`);
  }
  return ids;
}

/**
 * Narrow the collected ADRs by their source IDs. Matching is
 * case-insensitive. An ID that matches no collected ADR is a UserError, so a
 * typo cannot silently import the wrong set.
 */
export function filterAdrsToImport(
  adrs: AdrToImport[],
  filter: ImportFilter
): AdrToImport[] {
  const only = (filter.only ?? []).map((id) => id.toUpperCase());
  const exclude = (filter.exclude ?? []).map((id) => id.toUpperCase());
  if (only.length === 0 && exclude.length === 0) return adrs;

  const available = new Set(adrs.map((a) => a.originalId.toUpperCase()));
  const unknown = [...only, ...exclude].filter((id) => !available.has(id));
  if (unknown.length > 0) {
    const known = [...available].sort().join(", ");
    throw new UserError(
      `No ADR with ID ${unknown.join(", ")} in the given source(s). Available IDs: ${known}`
    );
  }

  if (only.length > 0) {
    const keep = new Set(only);
    return adrs.filter((a) => keep.has(a.originalId.toUpperCase()));
  }
  const drop = new Set(exclude);
  return adrs.filter((a) => !drop.has(a.originalId.toUpperCase()));
}

// ---------- Upstream lookup ----------

/**
 * Map each frontmatter `id` in `upstreamAdrsDir` to its file path. Files are
 * read in sorted order and the first file carrying an ID wins. Files with
 * missing or invalid frontmatter are skipped; read errors propagate.
 */
export function indexUpstreamAdrs(
  upstreamAdrsDir: string
): Map<string, string> {
  const index = new Map<string, string>();
  const files = readdirSync(upstreamAdrsDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  for (const file of files) {
    const path = join(upstreamAdrsDir, file);
    try {
      const { id } = parseAdr(readFileSync(path, "utf-8"), path).frontmatter;
      if (!index.has(id)) index.set(id, path);
    } catch (err) {
      if (!(err instanceof UserError || err instanceof SyntaxError)) throw err;
      logDebug("Skipping unparseable upstream ADR:", path);
    }
  }
  return index;
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
