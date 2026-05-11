// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { z } from "zod";

// ---------- Pack metadata (archgate-pack.yaml) ----------

export const PackMetadataSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/u, "name must be lowercase kebab-case"),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/u, "version must be semver (e.g., 0.1.0)"),
  description: z.string().min(1).max(500),
  maintainers: z.array(z.object({ github: z.string().min(1) })).min(1),
  tags: z
    .array(
      z
        .string()
        .regex(
          /^[a-z][a-z0-9-]*:[a-z][a-z0-9.-]*$/u,
          "tags must be namespaced (e.g., language:typescript)"
        )
    )
    .default([]),
  requires: z.array(z.string()).default([]),
});

export type PackMetadata = z.infer<typeof PackMetadataSchema>;

export function parsePackMetadata(raw: string): PackMetadata {
  const parsed = Bun.YAML.parse(raw) as Record<string, unknown>;
  return PackMetadataSchema.parse(parsed);
}

// ---------- Community links (community/links.yaml) ----------

export const CommunityLinkSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  tags: z.array(z.string()),
  description: z.string().min(1),
  submittedBy: z.string().min(1),
  submittedAt: z.string().date(),
});

export const CommunityLinksFileSchema = z.object({
  links: z.array(CommunityLinkSchema).default([]),
});

/** @internal */
export type CommunityLink = z.infer<typeof CommunityLinkSchema>;

// ---------- Imports manifest (.archgate/imports.json) ----------

export const ImportEntrySchema = z.object({
  source: z.string().min(1),
  version: z.string().optional(),
  importedAt: z.string().datetime(),
  adrIds: z.array(z.string()),
});

export const ImportsManifestSchema = z.object({
  imports: z.array(ImportEntrySchema).default([]),
});

/** @internal */
export type ImportEntry = z.infer<typeof ImportEntrySchema>;
export type ImportsManifest = z.infer<typeof ImportsManifestSchema>;
