// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { mkdirSync } from "node:fs";
import { styleText } from "node:util";

import type { Command } from "@commander-js/extra-typings";

import {
  buildIdMap,
  cleanupTempDirs,
  collectAdrsToImport,
  loadImportsManifest,
  resolveAndCloneSources,
  saveImportsManifest,
  updateImportsManifest,
  writeImportedAdrs,
} from "../../helpers/adr-import";
import { handleCommandError } from "../../helpers/exit";
import { formatJSON, isAgentContext, padCell } from "../../helpers/output";
import { requireProjectRoot } from "../../helpers/paths";
import {
  getMergedDomainPrefixes,
  resolvedProjectPaths,
} from "../../helpers/project-config";
import { withPromptFix } from "../../helpers/prompt";
import { ensureRulesShim } from "../../helpers/rules-shim";

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
      let tempDirs: string[] = [];
      try {
        const projectRoot = requireProjectRoot();
        const paths = resolvedProjectPaths(projectRoot);
        const useJson = opts.json || isAgentContext();

        if (opts.list) {
          const manifest = await loadImportsManifest(projectRoot);
          if (useJson) {
            console.log(formatJSON(manifest, opts.json ? true : undefined));
          } else if (manifest.imports.length === 0) {
            console.log("No ADRs have been imported yet.");
          } else {
            console.log(styleText("bold", "Imported ADR packs:\n"));
            for (const entry of manifest.imports) {
              // Boolean() assigned to a const first, not used as the ternary's
              // direct condition — see ARCH-014's no-extra-boolean-cast caveat.
              const hasVersion = Boolean(entry.version);
              console.log(
                `  ${entry.source}${hasVersion ? ` v${entry.version}` : ""} — ${entry.adrIds.length} ADR(s)`
              );
              for (const id of entry.adrIds) {
                console.log(`    ${id}`);
              }
            }
          }
          return;
        }

        const cloned = await resolveAndCloneSources(sources);
        const { resolved } = cloned;
        tempDirs = cloned.tempDirs;

        const adrsToImport = await collectAdrsToImport(resolved);

        if (adrsToImport.length === 0) {
          console.log("No ADRs found to import.");
          return;
        }

        // ---------- Determine prefix & remap IDs ----------

        mkdirSync(paths.adrsDir, { recursive: true });

        const domainPrefixes = getMergedDomainPrefixes(projectRoot);
        const idMap = buildIdMap(adrsToImport, paths.adrsDir, domainPrefixes);

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
              `${padCell("Original ID", origWidth)}${padCell("New ID", newWidth)}Title`
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
              `${padCell(entry.original, origWidth)}${padCell(entry.newId, newWidth)}${entry.title}`
            );
          }
          console.log();
        }

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
          return;
        }

        if (!opts.yes) {
          const { default: inquirer } = await import("inquirer");
          const confirmQuestions = [
            {
              type: "confirm" as const,
              name: "confirm" as const,
              message: `Import ${adrsToImport.length} ADR(s)?`,
              default: true,
            },
          ];
          const { confirm } = await withPromptFix<{ confirm: boolean }>(
            async () => inquirer.prompt(confirmQuestions)
          );
          if (!confirm) {
            console.log("Import cancelled.");
            return;
          }
        }

        await writeImportedAdrs(adrsToImport, idMap, paths.adrsDir);

        const manifest = await loadImportsManifest(projectRoot);
        updateImportsManifest(manifest, adrsToImport, idMap);
        saveImportsManifest(projectRoot, manifest);

        await ensureRulesShim(projectRoot, paths.adrsDir);

        // ---------- Summary ----------

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
        await handleCommandError(err);
      } finally {
        if (tempDirs.length > 0) cleanupTempDirs(tempDirs);
      }
    });
}
