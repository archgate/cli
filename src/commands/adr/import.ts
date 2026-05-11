// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  existsSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";

import { parseAdr } from "../../formats/adr";
import {
  ImportsManifestSchema,
  type ImportsManifest,
} from "../../formats/pack";
import { getNextId, slugify } from "../../helpers/adr-writer";
import { exitWith } from "../../helpers/exit";
import { logDebug, logError } from "../../helpers/log";
import { formatJSON, isAgentContext } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import {
  getMergedDomainPrefixes,
  resolvedProjectPaths,
} from "../../helpers/project-config";
import {
  resolveSource,
  shallowClone,
  detectTarget,
  type ImportTarget,
} from "../../helpers/registry";
import { ensureRulesShim } from "../../helpers/rules-shim";

// ---------- Imports manifest I/O ----------

async function loadImportsManifest(
  projectRoot: string
): Promise<ImportsManifest> {
  const importsPath = join(projectRoot, ".archgate", "imports.json");
  if (!existsSync(importsPath)) return { imports: [] };
  const raw = await Bun.file(importsPath).json();
  return ImportsManifestSchema.parse(raw);
}

function saveImportsManifest(
  projectRoot: string,
  manifest: ImportsManifest
): void {
  const importsPath = join(projectRoot, ".archgate", "imports.json");
  writeFileSync(importsPath, JSON.stringify(manifest, null, 2) + "\n");
}

// ---------- ID rewriting ----------

function rewriteAdrId(content: string, _oldId: string, newId: string): string {
  // Replace id in frontmatter YAML only (between --- delimiters).
  // We extract the frontmatter block, replace the id line, and reconstruct.
  const fmRegex = /^(---\r?\n)([\s\S]*?\r?\n)(---)/mu;
  const match = content.match(fmRegex);
  if (!match) return content;

  const [fullMatch, openDelim, fmBody, closeDelim] = match;
  const updatedFm = fmBody.replace(/^(id:\s*).*$/mu, `$1${newId}`);
  return content.replace(fullMatch, `${openDelim}${updatedFm}${closeDelim}`);
}

// ---------- Helpers to avoid await-in-loop ----------

interface ResolvedImport {
  source: string;
  target: ImportTarget;
  cloneDir: string;
}

interface AdrToImport {
  sourcePath: string;
  rulesPath: string | null;
  originalId: string;
  title: string;
  domain?: string;
  source: string;
  packVersion?: string;
}

/**
 * Resolve and clone all sources. Uses a cache to avoid re-cloning the same repo.
 * Sequential because clone N may share a repo with clone N+1 (dedup).
 */
async function resolveAndCloneSources(
  sources: string[]
): Promise<{ resolved: ResolvedImport[]; tempDirs: string[] }> {
  const tempDirs: string[] = [];
  const resolved: ResolvedImport[] = [];
  const cloneCache = new Map<string, string>();

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

    const target = await detectTarget(cloneDir, res.subpath); // eslint-disable-line no-await-in-loop -- depends on prior clone
    resolved.push({ source, target, cloneDir });
  }

  return { resolved, tempDirs };
}

/**
 * Read all ADR files from resolved targets and build the import list.
 */
async function collectAdrsToImport(
  resolved: ResolvedImport[]
): Promise<AdrToImport[]> {
  const adrsToImport: AdrToImport[] = [];

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
  for (const items of results) {
    adrsToImport.push(...items);
  }
  return adrsToImport;
}

/**
 * Write imported ADR files to disk with remapped IDs.
 * Returns list of written file paths for rollback on failure.
 */
async function writeImportedAdrs(
  adrsToImport: AdrToImport[],
  idMap: Array<{ original: string; newId: string; title: string }>,
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

// ---------- Command registration ----------

export function registerAdrImportCommand(adr: Command) {
  adr
    .command("import")
    .description("Import ADRs from the registry or a git repository")
    .argument("<source...>", "Registry path(s), org/repo/path, or git URL(s)")
    .option("--yes", "Skip confirmation prompt", false)
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Preview changes without writing", false)
    .option("--list", "List previously imported ADRs", false)
    .action(async (sources, opts) => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        logError("No .archgate/ directory found. Run `archgate init` first.");
        await exitWith(1);
        return;
      }

      try {
        const paths = resolvedProjectPaths(projectRoot);
        const useJson = opts.json || isAgentContext();

        // --list: show previously imported ADRs
        if (opts.list) {
          const manifest = await loadImportsManifest(projectRoot);
          if (useJson) {
            console.log(formatJSON(manifest, opts.json ? true : undefined));
          } else if (manifest.imports.length === 0) {
            console.log("No ADRs have been imported yet.");
          } else {
            console.log(styleText("bold", "Imported ADR packs:\n"));
            for (const entry of manifest.imports) {
              console.log(
                `  ${entry.source}${entry.version ? ` v${entry.version}` : ""} — ${entry.adrIds.length} ADR(s)`
              );
              for (const id of entry.adrIds) {
                console.log(`    ${id}`);
              }
            }
          }
          return;
        }

        // ---------- Resolve & clone ----------

        const { resolved, tempDirs } = await resolveAndCloneSources(sources);

        // ---------- Collect ADR files ----------

        const adrsToImport = await collectAdrsToImport(resolved);

        if (adrsToImport.length === 0) {
          console.log("No ADRs found to import.");
          cleanup(tempDirs);
          return;
        }

        // ---------- Determine prefix & remap IDs ----------

        mkdirSync(paths.adrsDir, { recursive: true });

        // Resolve each ADR's domain to the project's prefix for that domain.
        const domainPrefixes = getMergedDomainPrefixes(projectRoot);

        // Track the next available ID per prefix to avoid collisions
        const nextIdByPrefix = new Map<string, string>();

        const idMap: Array<{ original: string; newId: string; title: string }> =
          [];

        for (const adr of adrsToImport) {
          const prefix = (adr.domain && domainPrefixes[adr.domain]) || "ARCH";

          if (!nextIdByPrefix.has(prefix)) {
            nextIdByPrefix.set(prefix, getNextId(paths.adrsDir, prefix));
          }

          const nextId = nextIdByPrefix.get(prefix)!;
          idMap.push({
            original: adr.originalId,
            newId: nextId,
            title: adr.title,
          });

          const num = parseInt(nextId.replace(`${prefix}-`, ""), 10) + 1;
          nextIdByPrefix.set(
            prefix,
            `${prefix}-${String(num).padStart(3, "0")}`
          );
        }

        // ---------- Preview ----------

        if (!useJson) {
          console.log(
            styleText("bold", `\nADRs to import (${adrsToImport.length}):\n`)
          );
          const origWidth = 14;
          const newWidth = 14;
          console.log(
            styleText(
              "bold",
              `${"Original ID".padEnd(origWidth)}${"New ID".padEnd(newWidth)}Title`
            )
          );
          console.log(
            styleText(
              "dim",
              `${"─".repeat(origWidth)}${"─".repeat(newWidth)}${"─".repeat(30)}`
            )
          );
          for (const entry of idMap) {
            console.log(
              `${entry.original.padEnd(origWidth)}${entry.newId.padEnd(newWidth)}${entry.title}`
            );
          }
          console.log();
        }

        // ---------- Dry run ----------

        if (opts.dryRun) {
          if (useJson) {
            console.log(
              formatJSON(
                { dryRun: true, adrs: idMap },
                opts.json ? true : undefined
              )
            );
          } else {
            console.log("Dry run — no files written.");
          }
          cleanup(tempDirs);
          return;
        }

        // ---------- Confirmation ----------

        if (!opts.yes) {
          const { default: inquirer } = await import("inquirer");
          const { confirm } = await inquirer.prompt([
            {
              type: "confirm",
              name: "confirm",
              message: `Import ${adrsToImport.length} ADR(s)?`,
              default: true,
            },
          ]);
          if (!confirm) {
            console.log("Import cancelled.");
            cleanup(tempDirs);
            return;
          }
        }

        // ---------- Atomic write ----------

        await writeImportedAdrs(adrsToImport, idMap, paths.adrsDir);

        // ---------- Update imports.json ----------

        const manifest = await loadImportsManifest(projectRoot);
        const sourceGroups = new Map<
          string,
          { version?: string; ids: string[] }
        >();

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

        saveImportsManifest(projectRoot, manifest);

        // ---------- Ensure rules.d.ts ----------

        await ensureRulesShim(projectRoot, paths.adrsDir);

        // ---------- Cleanup & summary ----------

        cleanup(tempDirs);

        if (useJson) {
          console.log(
            formatJSON(
              {
                imported: idMap.map((m) => ({
                  originalId: m.original,
                  newId: m.newId,
                  title: m.title,
                })),
              },
              opts.json ? true : undefined
            )
          );
        } else {
          console.log(
            styleText(
              "green",
              `Imported ${adrsToImport.length} ADR(s) into ${paths.adrsDir}`
            )
          );
        }
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") throw err;
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });
}

function cleanup(dirs: string[]): void {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      logDebug("Failed to clean up temp dir:", dir);
    }
  }
}
