// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { z } from "zod";

export const DOMAIN_NAME_PATTERN = /^[a-z][a-z0-9-]*$/u;
const DOMAIN_PREFIX_PATTERN = /^[A-Z][A-Z0-9_]*$/u;

export const DomainNameSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(
    DOMAIN_NAME_PATTERN,
    "domain name must be lowercase kebab-case (e.g. 'security', 'ml-ops')"
  );

export const DomainPrefixSchema = z
  .string()
  .min(2)
  .max(10)
  .regex(
    DOMAIN_PREFIX_PATTERN,
    "domain prefix must be uppercase (e.g. 'SEC', 'MLOPS')"
  );

/**
 * Validate that a path is relative and does not escape the project root.
 * Rejects absolute paths (leading `/`, `\`, or drive letters like `C:\`)
 * and `..` segments that could traverse above the project root.
 */
const RelativePathSchema = z
  .string()
  .min(1, "path must not be empty")
  .refine((p) => !/^[/\\]/u.test(p) && !/^[A-Za-z]:[/\\]/u.test(p), {
    message: "path must be relative (no leading / or drive letter)",
  })
  .refine((p) => !/(^|\/)\.\.($|\/)/u.test(p.replaceAll("\\", "/")), {
    message: "path must not contain '..' segments",
  });

export const PathsConfigSchema = z.object({
  adrs: RelativePathSchema.optional(),
  rules: RelativePathSchema.optional(),
});

/**
 * Opt-in allow-list of directories that `.rules.ts` files may import shared
 * helpers from via relative paths. Entries are project-root-relative strings.
 *
 * The schema deliberately does NOT try to prove containment here: a path that
 * merely reads as safe can still escape `.archgate/` via a symlink, so the
 * authoritative HARD boundary (resolve → realpath → must be inside
 * `.archgate/`) is enforced against the filesystem in `resolveRuleImportDirs`.
 * Keeping the schema permissive lets that resolver surface a clear,
 * per-entry error rather than silently dropping the whole config.
 */
const RuleImportsConfigSchema = z.object({
  allowedDirs: z.array(z.string().min(1, "path must not be empty")).default([]),
});

export const ProjectConfigSchema = z
  .object({
    domains: z.record(DomainNameSchema, DomainPrefixSchema).default({}),
    paths: PathsConfigSchema.optional(),
    baseBranch: z.string().min(1).optional(),
    ruleImports: RuleImportsConfigSchema.optional(),
  })
  .default({ domains: {} });

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
