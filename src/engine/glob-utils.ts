// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/** Glob pattern utilities shared by the rules runner and git file listing. */

import { isAbsolute } from "node:path";

import type { GrepMatch } from "../formats/rules";
import { UserError } from "../helpers/user-error";

/**
 * Find every line of `content` matching `pattern`, as 1-based line/column
 * `GrepMatch`es labelled with `file`. Shared by `ctx.grep` (one file) and
 * `ctx.grepFiles` (many), which otherwise duplicated this scan.
 */
export function matchLines(
  content: string,
  pattern: RegExp,
  file: string
): GrepMatch[] {
  const lines = content.split("\n");
  // Clone the pattern and drive it with `exec()`, resetting `lastIndex` per
  // line. `String.prototype.match` with a global (`/g`) pattern returns every
  // match but strips the `index`, which collapsed the reported column to 1;
  // `exec()` always carries `index`. Cloning also keeps a caller's stateful
  // `/g` regex from leaking `lastIndex` across our per-line scan.
  const linePattern = new RegExp(pattern.source, pattern.flags);
  const matches: GrepMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    linePattern.lastIndex = 0;
    const match = linePattern.exec(lines[i]);
    if (match) {
      matches.push({
        file,
        line: i + 1,
        column: match.index + 1,
        content: lines[i],
      });
    }
  }
  return matches;
}

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
 * Expand brace patterns that contain path separators into separate patterns.
 *
 * Bun.Glob scanning silently returns empty results for brace groups whose
 * alternatives contain `/` (e.g. `svc/{src/env.ts,env.ts}`).  match() handles
 * them correctly — only the scanner is broken.  Filed upstream as
 * https://github.com/oven-sh/bun/issues/32596.
 *
 * This function detects `{alt1,alt2,...}` groups where at least one alternative
 * contains `/` and expands them into separate patterns so each one can be
 * scanned individually.  Braces whose alternatives are all simple names (no `/`)
 * are left for Bun.Glob to handle natively.
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
 * walking the filesystem. On large projects a directory walk visits every
 * entry under node_modules/, .venv/, data/, etc. only to discard them against
 * `trackedFiles` afterwards — per pattern, per rule. Matching the (much
 * smaller) tracked list directly eliminates that traversal entirely.
 *
 * `Bun.Glob#match()` matches dot-prefixed path segments without any option
 * (unlike directory scanning, see ARCH-020) and handles brace groups with
 * path separators correctly (oven-sh/bun#32596 only affects scanning), so
 * callers may pass patterns unexpanded.
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
 * `/`-normalized.
 *
 * The pattern and every brace-expanded alternative are validated first —
 * expansion can surface absolute or `..` alternatives hidden inside a brace
 * group (e.g. `{/etc/passwd,src/a.ts}`), and the sandbox contract must hold
 * on both paths below.
 *
 * Fast path: match against the git-tracked file list in memory — avoids
 * walking ignored trees (node_modules/, .venv/, ...) only to discard them
 * afterwards. Fallback (no git repo): walk the filesystem.
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
