// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PackMetadata } from "../formats/pack";
import { parsePackMetadata } from "../formats/pack";
import { logDebug } from "./log";

// ---------- Source resolution ----------

export interface ResolvedSource {
  kind: "official" | "github-repo" | "git-url";
  repoUrl: string;
  ref?: string;
  subpath: string;
}

/**
 * Strip an `@<ref>` suffix from the input, returning the base and ref.
 * Only the last `@` is treated as a ref separator. The `@` in `git@`
 * URLs is never treated as a ref separator.
 */
function stripRef(input: string): { base: string; ref?: string } {
  // git@ URLs use @ as part of the host syntax, not as a ref separator.
  // Only consider an @ that comes after the last `/` or `:` for git@ URLs.
  if (input.startsWith("git@")) {
    // For git@ URLs, look for @ref only after the path portion
    const lastSlash = input.lastIndexOf("/");
    const atIdx = input.lastIndexOf("@");
    // Only split on @ if it appears after the last path separator
    if (atIdx > lastSlash && lastSlash > 0) {
      return { base: input.slice(0, atIdx), ref: input.slice(atIdx + 1) };
    }
    return { base: input };
  }

  const atIdx = input.lastIndexOf("@");
  if (atIdx <= 0) return { base: input };
  return { base: input.slice(0, atIdx), ref: input.slice(atIdx + 1) };
}

const OFFICIAL_REGISTRY_URL = "https://github.com/archgate/awesome-adrs.git";

/**
 * Resolve a source string into a repo URL, optional ref, and subpath.
 *
 * Resolution rules (first match wins):
 * 1. Starts with "packs/" — official registry
 * 2. Is a URL (https://, http://, git@) — parse GitHub /tree/<ref>/<path>, else pass-through
 * 3. Has 3+ slash-separated segments — GitHub org/repo/path
 * 4. None of the above — error
 */
export function resolveSource(input: string): ResolvedSource {
  const { base, ref } = stripRef(input);

  // 1. Official registry
  if (base.startsWith("packs/")) {
    return {
      kind: "official",
      repoUrl: OFFICIAL_REGISTRY_URL,
      ref,
      subpath: base,
    };
  }

  // 2. Full URL
  if (/^https?:\/\//u.test(base) || base.startsWith("git@")) {
    // Try to parse GitHub /tree/<ref>/<path> form
    const ghMatch = base.match(
      /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/u
    );
    if (ghMatch) {
      const [, org, repo, treeRef, path] = ghMatch;
      return {
        kind: "git-url",
        repoUrl: `https://github.com/${org}/${repo}.git`,
        ref: ref ?? treeRef,
        subpath: path,
      };
    }

    // Plain git URL — subpath is root
    const repoUrl = base.endsWith(".git") ? base : `${base}.git`;
    return { kind: "git-url", repoUrl, ref, subpath: "." };
  }

  // 3. org/repo/path (3+ segments)
  const segments = base.split("/");
  if (segments.length >= 3) {
    const [org, repo, ...rest] = segments;
    return {
      kind: "github-repo",
      repoUrl: `https://github.com/${org}/${repo}.git`,
      ref,
      subpath: rest.join("/"),
    };
  }

  // 4. None matched
  throw new Error(
    `Cannot resolve source "${input}". Expected one of:\n` +
      `  - packs/<name>             (official registry)\n` +
      `  - <org>/<repo>/<path>      (GitHub repo)\n` +
      `  - https://github.com/...   (git URL)`
  );
}

// ---------- Git clone ----------

async function run(
  cmd: string[],
  opts?: { cwd?: string }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

/**
 * Shallow clone a git repository into a temporary directory.
 * Returns the path to the cloned directory.
 */
export async function shallowClone(
  repoUrl: string,
  ref?: string
): Promise<string> {
  const tempDir = mkdtempSync(join(tmpdir(), "archgate-import-"));

  const args = ["git", "clone", "--depth", "1"];
  if (ref) args.push("--branch", ref);
  args.push(repoUrl, tempDir);

  logDebug("Cloning:", args.join(" "));
  const result = await run(args);

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to clone ${repoUrl}${ref ? ` (ref: ${ref})` : ""}:\n${result.stderr.trim()}`
    );
  }

  return tempDir;
}

// ---------- Target detection ----------

export type ImportTarget =
  | {
      kind: "pack";
      packMeta: PackMetadata;
      adrFiles: string[];
      rulesFiles: string[];
      baseDir: string;
    }
  | {
      kind: "single-adr";
      adrFile: string;
      rulesFile: string | null;
      baseDir: string;
    };

/**
 * Detect whether the subpath within a cloned repo points to a full pack
 * (has archgate-pack.yaml) or a single ADR file (.md).
 */
export async function detectTarget(
  cloneDir: string,
  subpath: string
): Promise<ImportTarget> {
  const fullPath = join(cloneDir, subpath);

  // Check for a pack (directory with archgate-pack.yaml)
  const packYaml = join(fullPath, "archgate-pack.yaml");
  if (existsSync(packYaml)) {
    const raw = await Bun.file(packYaml).text();
    const packMeta = parsePackMetadata(raw);

    const adrsDir = join(fullPath, "adrs");
    let adrFiles: string[] = [];
    let rulesFiles: string[] = [];

    if (existsSync(adrsDir)) {
      const entries = readdirSync(adrsDir);
      adrFiles = entries
        .filter((f) => f.endsWith(".md"))
        .map((f) => join(adrsDir, f));
      rulesFiles = entries
        .filter((f) => f.endsWith(".rules.ts"))
        .map((f) => join(adrsDir, f));
    }

    return { kind: "pack", packMeta, adrFiles, rulesFiles, baseDir: adrsDir };
  }

  // Check for a single ADR file
  const mdPath = fullPath.endsWith(".md") ? fullPath : `${fullPath}.md`;
  if (existsSync(mdPath)) {
    const rulesPath = mdPath.replace(/\.md$/u, ".rules.ts");
    return {
      kind: "single-adr",
      adrFile: mdPath,
      rulesFile: existsSync(rulesPath) ? rulesPath : null,
      baseDir: join(mdPath, ".."),
    };
  }

  throw new Error(
    `Cannot detect import target at "${subpath}". Expected archgate-pack.yaml (pack) or a .md file (single ADR).`
  );
}
