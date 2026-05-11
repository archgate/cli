// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { parsePackMetadata } from "../formats/pack";
import { logDebug } from "./log";
import type { DetectedStack } from "./stack-detect";

export interface PackRecommendation {
  packPath: string;
  packName: string;
  description: string;
  adrCount: number;
  matchedTags: string[];
  relevance: "high" | "medium";
}

/**
 * Match a single pack tag against the detected stack.
 * Returns the relevance level or null if no match.
 */
function matchTag(
  tag: string,
  stack: DetectedStack
): { relevance: "high" | "medium"; tag: string } | null {
  const [namespace, value] = tag.split(":");
  if (!namespace || !value) return null;

  switch (namespace) {
    case "language":
      if (stack.languages.includes(value)) {
        return { relevance: "high", tag };
      }
      return null;
    case "runtime":
      if (stack.runtimes.includes(value)) {
        return { relevance: "high", tag };
      }
      return null;
    case "framework":
      if (stack.frameworks.includes(value)) {
        return { relevance: "high", tag };
      }
      return null;
    case "concern":
      // Concern tags match everyone with medium relevance
      return { relevance: "medium", tag };
    default:
      return null;
  }
}

/**
 * Count ADR markdown files in a pack's adrs/ directory.
 */
function countAdrs(packDir: string): number {
  const adrsDir = join(packDir, "adrs");
  if (!existsSync(adrsDir)) return 0;
  return readdirSync(adrsDir).filter((f) => f.endsWith(".md")).length;
}

/**
 * Scan a registry directory for packs and recommend those matching
 * the detected stack. Caller is responsible for providing the registry
 * directory (e.g. from a shallow clone).
 */
export function recommendPacksFromDir(
  stack: DetectedStack,
  registryDir: string
): PackRecommendation[] {
  const packsDir = join(registryDir, "packs");
  if (!existsSync(packsDir)) {
    logDebug("No packs/ directory found in registry:", registryDir);
    return [];
  }

  const packDirs = readdirSync(packsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const recommendations: PackRecommendation[] = [];

  for (const packName of packDirs) {
    const packDir = join(packsDir, packName);
    const yamlPath = join(packDir, "archgate-pack.yaml");
    if (!existsSync(yamlPath)) continue;

    let packMeta;
    try {
      const content = readFileSync(yamlPath, "utf-8");
      packMeta = parsePackMetadata(content);
    } catch (err) {
      logDebug(`Failed to parse pack metadata for ${packName}:`, String(err));
      continue;
    }

    const matchedTags: string[] = [];
    let bestRelevance: "high" | "medium" = "medium";

    for (const tag of packMeta.tags) {
      const match = matchTag(tag, stack);
      if (match) {
        matchedTags.push(match.tag);
        if (match.relevance === "high") {
          bestRelevance = "high";
        }
      }
    }

    // Only recommend packs that have at least one matching tag
    if (matchedTags.length === 0) continue;

    recommendations.push({
      packPath: `packs/${packName}`,
      packName,
      description: packMeta.description,
      adrCount: countAdrs(packDir),
      matchedTags,
      relevance: bestRelevance,
    });
  }

  // Sort: high relevance first, then alphabetically
  recommendations.sort((a, b) => {
    if (a.relevance !== b.relevance) {
      return a.relevance === "high" ? -1 : 1;
    }
    return a.packName.localeCompare(b.packName);
  });

  return recommendations;
}

/**
 * Resolve the registry (via shallow clone), scan for packs matching the
 * detected stack, and return recommendations. Cleans up the clone when done.
 */
export async function recommendPacks(
  stack: DetectedStack,
  _registryDir?: string
): Promise<PackRecommendation[]> {
  // Import shallowClone lazily to avoid circular dependencies
  const { shallowClone } = await import("./registry");

  let cloneDir: string | undefined;
  try {
    cloneDir = await shallowClone(
      "https://github.com/archgate/awesome-adrs.git"
    );
    return recommendPacksFromDir(stack, cloneDir);
  } finally {
    if (cloneDir) {
      try {
        rmSync(cloneDir, { recursive: true, force: true });
      } catch {
        logDebug("Failed to clean up registry clone:", cloneDir);
      }
    }
  }
}
