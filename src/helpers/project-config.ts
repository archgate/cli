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

import { existsSync, readFileSync } from "node:fs";

import {
  DOMAIN_PREFIXES as DEFAULT_DOMAIN_PREFIXES,
  ADR_DOMAINS as DEFAULT_DOMAINS,
} from "../formats/adr";
import {
  DomainNameSchema,
  DomainPrefixSchema,
  ProjectConfigSchema,
  type ProjectConfig,
} from "../formats/project-config";
import { logDebug } from "./log";
import { createPathIfNotExists, projectPath, projectPaths } from "./paths";

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
    const raw = JSON.parse(text) as unknown;
    const result = ProjectConfigSchema.safeParse(raw);
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
    throw new Error(
      `Unknown ADR domain '${domain}'. Known domains: ${known}. ` +
        `Register a custom domain with \`archgate domain add <name> <prefix>\`.`
    );
  }
  return prefix;
}

export function isDefaultDomain(domain: string): boolean {
  return (DEFAULT_DOMAINS as readonly string[]).includes(domain);
}

export interface DomainEntry {
  domain: string;
  prefix: string;
  source: "default" | "custom";
}

export function listDomainEntries(projectRoot: string): DomainEntry[] {
  const config = loadProjectConfig(projectRoot);
  const custom = config.domains;
  const defaults = DEFAULT_DOMAIN_PREFIXES as Record<string, string>;
  const merged: DomainEntry[] = [];

  for (const [domain, prefix] of Object.entries(defaults)) {
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
    throw new Error(nameResult.error.issues[0].message);
  }
  const prefixResult = DomainPrefixSchema.safeParse(prefix);
  if (!prefixResult.success) {
    throw new Error(prefixResult.error.issues[0].message);
  }
  if (isDefaultDomain(domain)) {
    throw new Error(
      `'${domain}' is a built-in domain and cannot be overridden.`
    );
  }

  const defaults = DEFAULT_DOMAIN_PREFIXES as Record<string, string>;
  const usedDefaultPrefix = Object.entries(defaults).find(
    ([, p]) => p === prefix
  );
  if (usedDefaultPrefix) {
    throw new Error(
      `Prefix '${prefix}' is already used by built-in domain '${usedDefaultPrefix[0]}'.`
    );
  }

  const config = loadProjectConfig(projectRoot);
  const collision = Object.entries(config.domains).find(
    ([name, p]) => name !== domain && p === prefix
  );
  if (collision) {
    throw new Error(
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
    throw new Error(`'${domain}' is a built-in domain and cannot be removed.`);
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
