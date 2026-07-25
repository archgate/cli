// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { lstatSync } from "node:fs";
import { resolve, isAbsolute, join, relative } from "node:path";

import { UserError } from "../helpers/user-error";

/**
 * Resolve a user-supplied path against projectRoot without any boundary check.
 */
export function resolveUserPath(
  resolvedRoot: string,
  userPath: string
): string {
  return isAbsolute(userPath)
    ? resolve(userPath)
    : resolve(resolvedRoot, userPath);
}

/**
 * Check whether an already-resolved absolute path stays within projectRoot.
 * On Windows, paths on different drives produce a full absolute relative()
 * result rather than a ".." prefix — use startsWith on the normalized paths.
 */
export function isWithinRoot(resolvedRoot: string, absPath: string): boolean {
  return (
    absPath.startsWith(resolvedRoot + "/") ||
    absPath.startsWith(resolvedRoot + "\\") ||
    absPath === resolvedRoot
  );
}

/**
 * Directories verified as real (non-symlink), memoized per process: safePath
 * runs once per glob result and siblings share every ancestor, so without this
 * the walk below re-lstats the same directories thousands of times per run.
 */
const verifiedRealDirs = new Set<string>();

/**
 * Reject a symlink anywhere in the path below the project root — the leaf OR
 * any ancestor, since a linked ancestor makes the leaf look like an ordinary
 * file to both `isWithinRoot` and a leaf `lstat`. Components at or above the
 * root are deliberately not inspected, and each test is a boolean `lstat`
 * rather than a `realpath` comparison.
 *
 * @throws {UserError} When any component below the root is a symbolic link.
 * @see ARCH-022 — why the walk stops at the root and avoids `realpath`
 */
function assertNoSymlinkInPath(
  resolvedRoot: string,
  absPath: string,
  userPath: string
): void {
  const rel = relative(resolvedRoot, absPath);
  // Empty (the root itself) or escaping — nothing below the root to walk.
  if (!rel || rel.startsWith("..")) return;

  const segments = rel.split(/[/\\]/u);
  let current = resolvedRoot;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    if (verifiedRealDirs.has(current)) continue;
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      // Does not exist (glob result, not-yet-created file): nothing can be
      // traversed through it, and the eventual read fails on its own.
      return;
    }
    if (stat.isSymbolicLink()) {
      throw new UserError(
        index === segments.length - 1
          ? `Path "${userPath}" is a symbolic link — access denied`
          : `Path "${userPath}" traverses symbolic link "${segment}" — access denied`
      );
    }
    if (stat.isDirectory()) verifiedRealDirs.add(current);
  }
}

/**
 * Resolve a user-supplied path and ensure it stays within projectRoot.
 * Throws if the resolved path escapes the project boundary, is a symlink, or
 * reaches its target through a symlinked ancestor directory.
 */
export function safePath(resolvedRoot: string, userPath: string): string {
  const absPath = resolveUserPath(resolvedRoot, userPath);
  if (!isWithinRoot(resolvedRoot, absPath)) {
    throw new UserError(
      `Path "${userPath}" escapes project root — access denied`
    );
  }
  assertNoSymlinkInPath(resolvedRoot, absPath, userPath);
  return absPath;
}
