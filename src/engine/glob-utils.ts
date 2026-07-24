// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/** Glob pattern utilities shared by the rules runner and git file listing. */

import { isAbsolute } from "node:path";

import { UserError } from "../helpers/user-error";

/**
 * Validate that a glob pattern cannot escape projectRoot via `..` segments.
 */
function safeGlob(pattern: string): void {
  if (pattern.includes("..")) {
    throw new UserError(
      `Glob pattern "${pattern}" contains ".." — access denied`
    );
  }
  if (isAbsolute(pattern)) {
    throw new UserError(
      `Glob pattern "${pattern}" is absolute — access denied`
    );
  }
}

/**
 * Expand brace groups whose alternatives contain `/` into separate patterns,
 * since Bun.Glob scanning silently returns empty results for those
 * (oven-sh/bun#32596 — match() is unaffected). Braces with only simple
 * alternatives are left for Bun.Glob to handle natively.
 */
export function expandBracePattern(pattern: string): string[] {
  const match = pattern.match(/^(.*?)\{([^{}]+)\}(.*)$/u);
  if (!match) return [pattern];

  const [, prefix, alternatives, suffix] = match;
  if (!alternatives.includes("/")) {
    // This brace group is safe for Bun.Glob, but check the suffix for others.
    const expandedSuffixes = expandBracePattern(suffix);
    if (expandedSuffixes.length === 1 && expandedSuffixes[0] === suffix) {
      return [pattern];
    }
    return expandedSuffixes.map((s) => `${prefix}{${alternatives}}${s}`);
  }

  const parts = alternatives.split(",");
  return parts.flatMap((part) =>
    expandBracePattern(`${prefix}${part}${suffix}`)
  );
}

/**
 * Match glob patterns against the git-tracked file list in memory instead of
 * walking the filesystem — ARCH-023 explains why this is both faster and
 * simpler. `Bun.Glob#match()` matches dot-prefixed segments without options
 * (unlike scanning, see ARCH-020) and handles `/`-containing brace groups
 * (oven-sh/bun#32596 only affects scanning), so patterns come in unexpanded.
 */
export function matchTrackedFiles(
  patterns: string[],
  trackedFiles: Set<string>
): Set<string> {
  const globs = patterns.map((p) => new Bun.Glob(p));
  const matched = new Set<string>();
  for (const file of trackedFiles) {
    if (globs.some((g) => g.match(file))) matched.add(file);
  }
  return matched;
}

/**
 * List project files matching a rule-supplied glob pattern, sorted and
 * `/`-normalized. Every brace-expanded alternative is validated first —
 * expansion can surface absolute or `..` alternatives hidden inside a brace
 * group, and the sandbox contract must hold on both paths below. Fast path:
 * in-memory match against git-tracked files (ARCH-023); fallback: walk.
 */
export async function listMatchingFiles(
  projectRoot: string,
  pattern: string,
  trackedFiles: Set<string> | null
): Promise<string[]> {
  // Expand brace patterns with path separators that Bun.Glob scanning drops.
  // See https://github.com/oven-sh/bun/issues/32596.
  const patterns = expandBracePattern(pattern);
  for (const p of patterns) safeGlob(p);

  if (trackedFiles) {
    return [...matchTrackedFiles(patterns, trackedFiles)].sort();
  }

  const seen = new Set<string>();
  for (const p of patterns) {
    const g = new Bun.Glob(p);
    // dot: true so rules can target dot-prefixed paths like `.github/`,
    // `.husky/`, `.vscode/` — first-class source dirs in code repos.
    // See https://github.com/archgate/cli/issues/222.
    // oxlint-disable-next-line no-await-in-loop -- sequential walk per expanded brace alternative
    for await (const file of g.scan({ cwd: projectRoot, dot: true })) {
      seen.add(file.replaceAll("\\", "/"));
    }
  }
  return [...seen].sort();
}
