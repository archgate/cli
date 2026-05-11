// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";

import {
  ImportsManifestSchema,
  type ImportsManifest,
} from "../../formats/pack";
import { exitWith } from "../../helpers/exit";
import { logDebug, logError, logWarn } from "../../helpers/log";
import { formatJSON, isAgentContext } from "../../helpers/output";
import { findProjectRoot } from "../../helpers/paths";
import { resolvedProjectPaths } from "../../helpers/project-config";
import { resolveSource, shallowClone } from "../../helpers/registry";

// ---------- Types ----------

interface AdrDiff {
  adrId: string;
  source: string;
  localPath: string;
  upstreamPath: string;
  hasChanges: boolean;
  /** Human-readable summary of what changed */
  summary: string;
}

interface SyncResult {
  checked: number;
  withChanges: number;
  upToDate: number;
  errors: number;
  diffs: AdrDiff[];
}

// ---------- Imports manifest I/O ----------

function loadImportsManifest(projectRoot: string): ImportsManifest {
  const importsPath = join(projectRoot, ".archgate", "imports.json");
  if (!existsSync(importsPath)) return { imports: [] };
  const raw = readFileSync(importsPath, "utf-8");
  return ImportsManifestSchema.parse(JSON.parse(raw));
}

function saveImportsManifest(
  projectRoot: string,
  manifest: ImportsManifest
): void {
  const importsPath = join(projectRoot, ".archgate", "imports.json");
  const content = JSON.stringify(manifest, null, 2) + "\n";
  Bun.write(importsPath, content);
}

// ---------- Diff helpers ----------

/**
 * Find the local ADR file by ID in the adrs directory.
 */
function findLocalAdr(adrsDir: string, adrId: string): string | null {
  if (!existsSync(adrsDir)) return null;
  const files = readdirSync(adrsDir);
  const match = files.find(
    (f) => f.endsWith(".md") && f.startsWith(`${adrId}-`)
  );
  return match ? join(adrsDir, match) : null;
}

/**
 * Generate a human-readable summary of which sections changed between
 * two ADR markdown files.
 */
function diffSummary(localContent: string, upstreamContent: string): string {
  if (localContent === upstreamContent) return "No changes";

  const localLines = localContent.split("\n");
  const upstreamLines = upstreamContent.split("\n");

  const changedSections: string[] = [];

  // Track which sections have differences
  const localSections = new Map<string, string[]>();
  const upstreamSections = new Map<string, string[]>();

  for (const [lines, sections] of [
    [localLines, localSections],
    [upstreamLines, upstreamSections],
  ] as const) {
    let section = "header";
    for (const line of lines) {
      const headingMatch = line.match(/^#{1,3}\s+(.+)/u);
      if (headingMatch) {
        section = headingMatch[1].trim();
      }
      if (!sections.has(section)) sections.set(section, []);
      sections.get(section)!.push(line);
    }
  }

  for (const [section, localLines] of localSections) {
    const upstreamLines = upstreamSections.get(section);
    if (!upstreamLines || localLines.join("\n") !== upstreamLines.join("\n")) {
      changedSections.push(section);
    }
  }

  // Check for new sections in upstream
  for (const section of upstreamSections.keys()) {
    if (!localSections.has(section) && !changedSections.includes(section)) {
      changedSections.push(section);
    }
  }

  if (changedSections.length === 0) return "Whitespace or formatting changes";
  return `Changed: ${changedSections.join(", ")}`;
}

// ---------- Cleanup ----------

function cleanup(dirs: string[]): void {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      logDebug("Failed to clean up temp dir:", dir);
    }
  }
}

// ---------- Command registration ----------

export function registerAdrSyncCommand(adr: Command) {
  adr
    .command("sync")
    .description("Check for upstream updates to imported ADRs")
    .argument("[source...]", "Source filter(s) — sync only matching imports")
    .option("--check", "Exit 1 if upstream has updates (CI mode)", false)
    .option("--yes", "Skip confirmation prompts", false)
    .option("--json", "Output as JSON", false)
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
        const manifest = loadImportsManifest(projectRoot);

        if (manifest.imports.length === 0) {
          if (useJson) {
            console.log(
              formatJSON(
                { status: "empty", message: "No imported ADRs found." },
                opts.json ? true : undefined
              )
            );
          } else {
            console.log("No imported ADRs found.");
          }
          return;
        }

        // Filter imports by source args if provided
        let imports = manifest.imports;
        if (sources.length > 0) {
          imports = imports.filter((entry) =>
            sources.some((s) => entry.source.includes(s))
          );
          if (imports.length === 0) {
            if (useJson) {
              console.log(
                formatJSON(
                  {
                    status: "no-match",
                    message: "No imports match the given source filter(s).",
                  },
                  opts.json ? true : undefined
                )
              );
            } else {
              console.log("No imports match the given source filter(s).");
            }
            return;
          }
        }

        // Clone upstream repos and compare
        const tempDirs: string[] = [];
        const cloneCache = new Map<string, string>();
        const result: SyncResult = {
          checked: 0,
          withChanges: 0,
          upToDate: 0,
          errors: 0,
          diffs: [],
        };

        for (const entry of imports) {
          let resolved;
          try {
            resolved = resolveSource(entry.source);
          } catch (err) {
            logWarn(
              `Cannot resolve source "${entry.source}": ${err instanceof Error ? err.message : String(err)}`
            );
            result.errors++;
            continue;
          }

          const cacheKey = `${resolved.repoUrl}#${resolved.ref ?? ""}`;
          let cloneDir = cloneCache.get(cacheKey);

          if (!cloneDir) {
            try {
              cloneDir = await shallowClone(resolved.repoUrl, resolved.ref); // oxlint-disable-line no-await-in-loop -- sequential by design (dedup cache)
              cloneCache.set(cacheKey, cloneDir);
              tempDirs.push(cloneDir);
            } catch (err) {
              logWarn(
                `Failed to clone ${resolved.repoUrl}: ${err instanceof Error ? err.message : String(err)}`
              );
              result.errors++;
              continue;
            }
          }

          // Compare each ADR in this import entry
          for (const adrId of entry.adrIds) {
            result.checked++;

            const localPath = findLocalAdr(paths.adrsDir, adrId);
            if (!localPath) {
              logWarn(`Local ADR ${adrId} not found in ${paths.adrsDir}`);
              result.errors++;
              continue;
            }

            // Find the upstream ADR file
            const upstreamSubpath = resolved.subpath;
            const upstreamAdrsDir = join(cloneDir, upstreamSubpath, "adrs");

            if (!existsSync(upstreamAdrsDir)) {
              logDebug(
                `Upstream adrs dir not found: ${upstreamAdrsDir}`
              );
              result.errors++;
              continue;
            }

            const upstreamFiles = readdirSync(upstreamAdrsDir).filter((f) =>
              f.endsWith(".md")
            );

            // We need to find the upstream file. Since IDs were remapped on import,
            // we compare content structure. For simplicity, match by position in the
            // import list or by comparing titles/content.
            // A reasonable heuristic: use the order in adrIds vs the sorted upstream files.
            const adrIndex = entry.adrIds.indexOf(adrId);
            const upstreamFile =
              adrIndex < upstreamFiles.length
                ? join(upstreamAdrsDir, upstreamFiles.sort()[adrIndex])
                : null;

            if (!upstreamFile || !existsSync(upstreamFile)) {
              logDebug(`Upstream ADR file not found for ${adrId}`);
              result.errors++;
              continue;
            }

            const localContent = readFileSync(localPath, "utf-8");
            const upstreamContent = readFileSync(upstreamFile, "utf-8");

            // Strip frontmatter ID for comparison (since IDs were remapped)
            const stripId = (content: string) =>
              content.replace(/^(id:\s*).*$/mu, "");

            const hasChanges =
              stripId(localContent) !== stripId(upstreamContent);

            const diff: AdrDiff = {
              adrId,
              source: entry.source,
              localPath,
              upstreamPath: upstreamFile,
              hasChanges,
              summary: hasChanges
                ? diffSummary(localContent, upstreamContent)
                : "Up to date",
            };

            result.diffs.push(diff);
            if (hasChanges) {
              result.withChanges++;
            } else {
              result.upToDate++;
            }
          }
        }

        // --- Check mode: report and exit ---
        if (opts.check) {
          if (useJson) {
            console.log(
              formatJSON(
                {
                  status:
                    result.withChanges > 0 ? "updates-available" : "up-to-date",
                  checked: result.checked,
                  withChanges: result.withChanges,
                  upToDate: result.upToDate,
                  errors: result.errors,
                  diffs: result.diffs
                    .filter((d) => d.hasChanges)
                    .map((d) => ({
                      adrId: d.adrId,
                      source: d.source,
                      summary: d.summary,
                    })),
                },
                opts.json ? true : undefined
              )
            );
          } else if (result.withChanges > 0) {
            console.log(
              styleText(
                "yellow",
                `${result.withChanges} ADR(s) have upstream updates:`
              )
            );
            for (const diff of result.diffs.filter((d) => d.hasChanges)) {
              console.log(
                `  ${diff.adrId} (${diff.source}): ${diff.summary}`
              );
            }
          } else {
            console.log(
              styleText("green", "All imported ADRs are up to date.")
            );
          }

          cleanup(tempDirs);
          if (result.withChanges > 0) {
            await exitWith(1);
          }
          return;
        }

        // --- Interactive mode: prompt for each changed ADR ---
        if (result.withChanges === 0) {
          if (useJson) {
            console.log(
              formatJSON(
                {
                  status: "up-to-date",
                  checked: result.checked,
                  withChanges: 0,
                  upToDate: result.upToDate,
                },
                opts.json ? true : undefined
              )
            );
          } else {
            console.log(
              styleText("green", "All imported ADRs are up to date.")
            );
          }
          cleanup(tempDirs);
          return;
        }

        if (!useJson) {
          console.log(
            styleText(
              "bold",
              `\n${result.withChanges} ADR(s) have upstream updates:\n`
            )
          );
        }

        let updatedCount = 0;
        const changedDiffs = result.diffs.filter((d) => d.hasChanges);

        for (const diff of changedDiffs) {
          if (!useJson) {
            console.log(
              `${styleText("bold", diff.adrId)} (${diff.source}): ${diff.summary}`
            );
          }

          let action: "keep" | "take" | "skip" = "skip";

          if (opts.yes) {
            action = "take";
          } else if (!useJson && process.stdin.isTTY) {
            const { default: inquirer } = await import("inquirer"); // oxlint-disable-line no-await-in-loop -- sequential interactive prompts
            const { choice } = await inquirer.prompt([ // oxlint-disable-line no-await-in-loop -- sequential interactive prompts
              {
                type: "list",
                name: "choice",
                message: `${diff.adrId}: What would you like to do?`,
                choices: [
                  { name: "Keep local", value: "keep" },
                  { name: "Take upstream", value: "take" },
                  { name: "Skip", value: "skip" },
                ],
              },
            ]);
            action = choice;
          }

          if (action === "take") {
            // Read upstream content and rewrite the ID to match local
            const upstreamContent = readFileSync(diff.upstreamPath, "utf-8");
            const rewritten = upstreamContent.replace(
              /^(id:\s*).*$/mu,
              `$1${diff.adrId}`
            );
            await Bun.write(diff.localPath, rewritten); // oxlint-disable-line no-await-in-loop -- sequential writes after interactive prompt
            updatedCount++;
            if (!useJson) {
              console.log(
                styleText("green", `  Updated ${diff.adrId} from upstream`)
              );
            }
          } else if (action === "keep" && !useJson) {
            console.log(styleText("dim", `  Kept local version of ${diff.adrId}`));
          }
        }

        // Update imports.json timestamps
        const updatedManifest = loadImportsManifest(projectRoot);
        for (const entry of updatedManifest.imports) {
          if (
            sources.length === 0 ||
            sources.some((s) => entry.source.includes(s))
          ) {
            entry.importedAt = new Date().toISOString();
          }
        }
        saveImportsManifest(projectRoot, updatedManifest);

        cleanup(tempDirs);

        if (useJson) {
          console.log(
            formatJSON(
              {
                status: "synced",
                checked: result.checked,
                updated: updatedCount,
                withChanges: result.withChanges,
                upToDate: result.upToDate,
              },
              opts.json ? true : undefined
            )
          );
        } else {
          console.log("");
          if (updatedCount > 0) {
            console.log(
              styleText(
                "green",
                `Synced ${updatedCount} ADR(s) from upstream.`
              )
            );
          } else {
            console.log("No ADRs were updated.");
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") throw err;
        logError(err instanceof Error ? err.message : String(err));
        await exitWith(1);
      }
    });
}
