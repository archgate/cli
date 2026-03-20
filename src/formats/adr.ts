import { z } from "zod";

export const ADR_DOMAINS = [
  "backend",
  "frontend",
  "data",
  "architecture",
  "general",
] as const;

export type AdrDomain = (typeof ADR_DOMAINS)[number];

export const DOMAIN_PREFIXES: Record<AdrDomain, string> = {
  backend: "BE",
  frontend: "FE",
  data: "DATA",
  architecture: "ARCH",
  general: "GEN",
};

export const AdrFrontmatterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  domain: z.enum(ADR_DOMAINS),
  rules: z.boolean(),
  files: z.array(z.string()).optional(),
});

export type AdrFrontmatter = z.infer<typeof AdrFrontmatterSchema>;

export interface AdrDocument {
  frontmatter: AdrFrontmatter;
  body: string;
  filePath: string;
}

/**
 * Parse YAML frontmatter from a raw string (the content between --- delimiters).
 */
export function parseFrontmatter(raw: string): Record<string, unknown> {
  return (Bun.YAML.parse(raw) as Record<string, unknown>) ?? {};
}

function formatZodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * Parse ADR content (frontmatter + body) into an AdrDocument.
 * Throws on invalid frontmatter.
 */
export function parseAdr(content: string, filePath: string): AdrDocument {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    throw new Error(`No frontmatter found in ${filePath}`);
  }

  const rawFrontmatter = match[1];
  const body = content.slice(match[0].length).trim();
  const data = parseFrontmatter(rawFrontmatter);
  const result = AdrFrontmatterSchema.safeParse(data);

  if (!result.success) {
    const errors = formatZodErrors(result.error);
    throw new Error(
      `Invalid ADR frontmatter in ${filePath}:\n  - ${errors.join("\n  - ")}`
    );
  }

  return { frontmatter: result.data, body, filePath };
}
