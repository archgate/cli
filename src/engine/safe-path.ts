// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { lstatSync, realpathSync } from "node:fs";
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
 * Components already verified safe, memoized per process: safePath runs once
 * per glob result and siblings share every ancestor. Nested per root — the
 * same component under two roots can differ, since a link leaving root A may
 * land inside an enclosing root B.
 */
const verifiedComponents = new Map<string, Set<string>>();

/** Project roots resolved through `realpath`, memoized per process. */
const realRoots = new Map<string, string>();

/**
 * The project root with symlinks in its own path resolved, so a link target
 * compares against it like-for-like. Falls back to the lexical root.
 */
function realRootOf(resolvedRoot: string): string {
  let hit = realRoots.get(resolvedRoot);
  if (hit === undefined) {
    try {
      hit = realpathSync(resolvedRoot);
    } catch {
      hit = resolvedRoot;
    }
    realRoots.set(resolvedRoot, hit);
  }
  return hit;
}

/**
 * Reject a path whose real target lies outside the project root, testing every
 * component below it — the leaf AND every ancestor, since a linked ancestor
 * makes the leaf look ordinary to both `isWithinRoot` and a leaf `lstat`. The
 * gate is where a link POINTS, not that one exists: links resolving back
 * inside the project are a normal layout (workspace monorepos, shared dirs).
 *
 * @throws {UserError} When a component resolves outside the project root.
 * @see ARCH-022 — why the walk stops at the root
 * @see .claude/agent-memory/archgate-developer/project_rules_engine_internals.md — why both sides are realpath'd
 */
function assertNoEscapingSymlink(
  resolvedRoot: string,
  absPath: string,
  userPath: string
): void {
  const rel = relative(resolvedRoot, absPath);
  // Empty (the root itself) or escaping — nothing below the root to walk.
  if (!rel || rel.startsWith("..")) return;

  const segments = rel.split(/[/\\]/u);
  let verified = verifiedComponents.get(resolvedRoot);
  if (!verified) {
    verified = new Set();
    verifiedComponents.set(resolvedRoot, verified);
  }

  let current = resolvedRoot;
  for (const segment of segments) {
    current = join(current, segment);
    if (verified.has(current)) continue;
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      // Does not exist (glob result, not-yet-created file): nothing can be
      // traversed through it, and the eventual read fails on its own.
      return;
    }
    if (stat.isSymbolicLink()) {
      let target: string;
      try {
        target = realpathSync(current);
      } catch {
        return; // Broken link — resolves to nothing, so it reaches nothing.
      }
      if (!isWithinRoot(realRootOf(resolvedRoot), target)) {
        throw new UserError(
          `Path "${userPath}" resolves outside the project through symbolic link "${segment}" — access denied`
        );
      }
    }
    verified.add(current);
  }
}

/**
 * Resolve a user-supplied path and ensure it stays within projectRoot, either
 * lexically or after resolving symlinks at any component. Links resolving back
 * inside the project are allowed.
 *
 * @throws {UserError} When the path escapes the project root.
 */
export function safePath(resolvedRoot: string, userPath: string): string {
  const absPath = resolveUserPath(resolvedRoot, userPath);
  if (!isWithinRoot(resolvedRoot, absPath)) {
    throw new UserError(
      `Path "${userPath}" escapes project root — access denied`
    );
  }
  assertNoEscapingSymlink(resolvedRoot, absPath, userPath);
  return absPath;
}
