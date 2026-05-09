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

export const ProjectConfigSchema = z
  .object({
    domains: z.record(DomainNameSchema, DomainPrefixSchema).default({}),
  })
  .default({ domains: {} });

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
