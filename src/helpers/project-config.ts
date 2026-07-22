// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * project-config.ts — Read/write `.archgate/config.json` at project root.
 *
 * Currently stores custom ADR domain → prefix mappings that extend the
 * built-in defaults (backend/frontend/data/architecture/general). Defaults
 * are never persisted; they are merged in at read time and cannot be
 * overwritten or removed via the config.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  DOMAIN_PREFIXES as DEFAULT_DOMAIN_PREFIXES,
  ADR_DOMAINS,
} from "../formats/adr";
import {
  DomainNameSchema,
  DomainPrefixSchema,
  ProjectConfigSchema,
  type ProjectConfig,
} from "../formats/project-config";
import { logDebug } from "./log";
import {
  createPathIfNotExists,
  isPathInside,
  projectPath,
  projectPaths,
} from "./paths";
import { UserError } from "./user-error";

const CONFIG_FILE = "config.json";

function configPath(projectRoot: string): string {
  return projectPath(projectRoot, CONFIG_FILE);
}

const EMPTY_CONFIG: ProjectConfig = { domains: {} };

/**
 * Load the project config from `.archgate/config.json`. Returns an empty
 * config (no custom domains) when the file is missing or malformed.
 * Caller side-effect free — no caching to avoid stale reads after writes
 * from this same process (e.g., `domain add` followed by `adr create`).
 */
export function loadProjectConfig(projectRoot: string): ProjectConfig {
  const path = configPath(projectRoot);
  if (!existsSync(path)) return EMPTY_CONFIG;

  try {
    const text = readFileSync(path, "utf-8");
    const result = ProjectConfigSchema.safeParse(JSON.parse(text));
    if (!result.success) {
      logDebug("Project config invalid, using empty:", result.error.message);
      return EMPTY_CONFIG;
    }
    return result.data;
  } catch (err) {
    logDebug("Project config read failed, using empty:", String(err));
    return EMPTY_CONFIG;
  }
}

/**
 * Write the project config to disk.
 */
export async function saveProjectConfig(
  projectRoot: string,
  config: ProjectConfig
): Promise<void> {
  const path = configPath(projectRoot);
  createPathIfNotExists(projectPaths(projectRoot).root);
  await Bun.write(path, JSON.stringify(config, null, 2) + "\n");
  logDebug("Project config saved:", path);
}

/**
 * Merge built-in defaults with any custom domains from the project config.
 * Custom domains cannot overwrite defaults — defaults win on conflict.
 */
export function getMergedDomainPrefixes(
  projectRoot: string
): Record<string, string> {
  const config = loadProjectConfig(projectRoot);
  return { ...config.domains, ...DEFAULT_DOMAIN_PREFIXES };
}

export function getAllDomainNames(projectRoot: string): string[] {
  return Object.keys(getMergedDomainPrefixes(projectRoot)).sort();
}

/**
 * Resolve the ID prefix for a given domain name against the merged config.
 * Throws when the domain is unknown — callers should surface a useful error
 * mentioning `archgate domain add` or the list of known domains.
 */
export function resolveDomainPrefix(
  projectRoot: string,
  domain: string
): string {
  const prefixes = getMergedDomainPrefixes(projectRoot);
  const prefix = prefixes[domain];
  if (!prefix) {
    const known = Object.keys(prefixes).sort().join(", ");
    throw new UserError(
      `Unknown ADR domain '${domain}'. Known domains: ${known}. ` +
        `Register a custom domain with \`archgate domain add <name> <prefix>\`.`
    );
  }
  return prefix;
}

/**
 * Read the `baseBranch` value from `.archgate/config.json`.
 * Returns `null` when unconfigured.
 */
export function getConfiguredBaseBranch(projectRoot: string): string | null {
  const config = loadProjectConfig(projectRoot);
  return config.baseBranch ?? null;
}

/**
 * Detect the base branch and save it to `.archgate/config.json` when not
 * already configured. Idempotent — skips if `baseBranch` is already set.
 * Non-fatal — silently logs on failure (not a git repo, read-only fs, etc.).
 *
 * Used by both `archgate init` (eager) and `resolveBaseRef` (lazy on first check).
 */
export async function ensureBaseBranch(
  projectRoot: string,
  detectBaseRef: (root: string) => Promise<string | null>
): Promise<string | null> {
  const config = loadProjectConfig(projectRoot);
  if (config.baseBranch) return config.baseBranch;

  try {
    const detected = await detectBaseRef(projectRoot);
    if (detected) {
      await saveProjectConfig(projectRoot, { ...config, baseBranch: detected });
      logDebug("Saved detected base branch to config:", detected);
    }
    return detected;
  } catch {
    logDebug("Base branch detection failed (not a git repo?)");
    return null;
  }
}

export function isDefaultDomain(domain: string): boolean {
  return ADR_DOMAINS.some((d) => d === domain);
}

export interface DomainEntry {
  domain: string;
  prefix: string;
  source: "default" | "custom";
}

export function listDomainEntries(projectRoot: string): DomainEntry[] {
  const config = loadProjectConfig(projectRoot);
  const custom = config.domains;
  const merged: DomainEntry[] = [];

  for (const [domain, prefix] of Object.entries(DEFAULT_DOMAIN_PREFIXES)) {
    merged.push({ domain, prefix, source: "default" });
  }
  for (const [domain, prefix] of Object.entries(custom)) {
    if (isDefaultDomain(domain)) continue;
    merged.push({ domain, prefix, source: "custom" });
  }

  return merged.sort((a, b) => a.domain.localeCompare(b.domain));
}

/**
 * Add a custom domain to the project config. Validates name + prefix format
 * and rejects collisions with defaults. Does not catch writes — callers
 * handle any I/O errors.
 */
export async function addCustomDomain(
  projectRoot: string,
  domain: string,
  prefix: string
): Promise<ProjectConfig> {
  const nameResult = DomainNameSchema.safeParse(domain);
  if (!nameResult.success) {
    throw new UserError(nameResult.error.issues[0].message);
  }
  const prefixResult = DomainPrefixSchema.safeParse(prefix);
  if (!prefixResult.success) {
    throw new UserError(prefixResult.error.issues[0].message);
  }
  if (isDefaultDomain(domain)) {
    throw new UserError(
      `'${domain}' is a built-in domain and cannot be overridden.`
    );
  }

  const usedDefaultPrefix = Object.entries(DEFAULT_DOMAIN_PREFIXES).find(
    ([, p]) => p === prefix
  );
  if (usedDefaultPrefix) {
    throw new UserError(
      `Prefix '${prefix}' is already used by built-in domain '${usedDefaultPrefix[0]}'.`
    );
  }

  const config = loadProjectConfig(projectRoot);
  const collision = Object.entries(config.domains).find(
    ([name, p]) => name !== domain && p === prefix
  );
  if (collision) {
    throw new UserError(
      `Prefix '${prefix}' is already used by custom domain '${collision[0]}'.`
    );
  }

  const next: ProjectConfig = {
    ...config,
    domains: { ...config.domains, [domain]: prefix },
  };
  await saveProjectConfig(projectRoot, next);
  return next;
}

export async function removeCustomDomain(
  projectRoot: string,
  domain: string
): Promise<{ config: ProjectConfig; removed: boolean }> {
  if (isDefaultDomain(domain)) {
    throw new UserError(
      `'${domain}' is a built-in domain and cannot be removed.`
    );
  }
  const config = loadProjectConfig(projectRoot);
  if (!(domain in config.domains)) {
    return { config, removed: false };
  }
  const nextDomains = { ...config.domains };
  delete nextDomains[domain];
  const next: ProjectConfig = { ...config, domains: nextDomains };
  await saveProjectConfig(projectRoot, next);
  return { config: next, removed: true };
}

/**
 * Resolve the opt-in `ruleImports.allowedDirs` config into absolute, canonical
 * (realpath'd) directories that `.rules.ts` files may import shared helpers
 * from via relative paths.
 *
 * HARD CONTAINMENT BOUNDARY: every configured entry is resolved against the
 * project root, realpath-canonicalized, and MUST be an existing directory that
 * lands inside `<projectRoot>/.archgate/`. Any entry that escapes — via `..`, an
 * absolute path, or a symlink whose target is outside the tree — is rejected
 * with a {@link UserError} naming it, as is a path that resolves to a file
 * rather than a directory. The `.archgate/` tree itself is also anchored to the
 * real project root, so a symlinked `.archgate/` pointing outside the repo
 * cannot smuggle the boundary elsewhere. This holds regardless of the
 * configured value: the config can never authorize a path outside `.archgate/`.
 *
 * Returns `[]` when the field is absent or empty, which preserves the default
 * behavior of blocking every relative import in rule files.
 */
export function resolveRuleImportDirs(projectRoot: string): string[] {
  const dirs = loadProjectConfig(projectRoot).ruleImports?.allowedDirs ?? [];
  if (dirs.length === 0) return [];

  let realProjectRoot: string;
  let archgateRoot: string;
  try {
    realProjectRoot = realpathSync(projectRoot);
    archgateRoot = realpathSync(projectPaths(projectRoot).root);
  } catch (err) {
    // A missing `.archgate/` (or project root) means nothing can be imported —
    // treat as unconfigured so the default (block everything) applies.
    if ((err as { code?: string }).code === "ENOENT") return [];
    // Any other fault (EACCES, ELOOP, …) on an otherwise-configured project is a
    // real problem worth surfacing, not a silent feature-disable — `dirs` is
    // non-empty here, so `.archgate/config.json` already parsed successfully.
    throw new UserError(
      `Could not resolve the .archgate/ directory for rule imports: ${String(err)}`,
      "Check filesystem permissions and that .archgate/ is not a broken or looping symlink."
    );
  }

  // The `.archgate/` tree itself MUST live inside the (realpath'd) project root.
  // If `.archgate` is a symlink pointing outside the repo, canonicalizing the
  // configured dirs against it would authorize imports outside the project —
  // defeating the containment boundary. Anchor to the real project root so the
  // guarantee holds regardless of what `.archgate` points at.
  if (!isPathInside(archgateRoot, join(realProjectRoot, ".archgate"))) {
    throw new UserError(
      `The .archgate/ directory resolves outside the project root (${archgateRoot}).`,
      "Rule-file imports are confined to the .archgate/ governance tree; a symlinked .archgate/ pointing elsewhere is not allowed."
    );
  }

  return dirs.map((dir) => {
    const abs = resolve(projectRoot, dir);
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      throw new UserError(
        `Invalid ruleImports.allowedDirs entry "${dir}": directory does not exist.`,
        "It must be an existing directory inside .archgate/."
      );
    }
    if (!isPathInside(real, archgateRoot)) {
      throw new UserError(
        `Invalid ruleImports.allowedDirs entry "${dir}": resolves outside .archgate/ (${real}).`,
        "Rule-file imports are confined to the .archgate/ governance tree."
      );
    }
    if (!statSync(real).isDirectory()) {
      throw new UserError(
        `Invalid ruleImports.allowedDirs entry "${dir}": not a directory (${real}).`,
        "Each ruleImports.allowedDirs entry must be a directory inside .archgate/."
      );
    }
    return real;
  });
}

/**
 * Resolve project paths with config-aware overrides.
 *
 * Reads `.archgate/config.json` and applies any custom `paths.adrs` or
 * `paths.rules` overrides. When `paths.rules` is not set, rules are
 * loaded from the same directory as ADRs (co-location convention).
 * Falls back to the standard `.archgate/adrs/` and `.archgate/lint/`
 * defaults when no `paths` config is present.
 */
export function resolvedProjectPaths(projectRoot: string): {
  root: string;
  adrsDir: string;
  lintDir: string;
} {
  const defaults = projectPaths(projectRoot);
  const config = loadProjectConfig(projectRoot);

  if (!config.paths) return defaults;

  return {
    root: defaults.root,
    adrsDir: config.paths.adrs
      ? join(projectRoot, config.paths.adrs)
      : defaults.adrsDir,
    lintDir: config.paths.rules
      ? join(projectRoot, config.paths.rules)
      : defaults.lintDir,
  };
}
