/**
 * Generates `public/llms-full.txt` by concatenating all English documentation
 * pages into a single markdown file for LLM consumption.
 *
 * Strips YAML frontmatter and JSX/import lines, keeping only prose and code
 * blocks. Run automatically before `astro build` or manually:
 *
 *   bun run docs/scripts/generate-llms-full.ts
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const docsDir = join(import.meta.dirname, "..", "src", "content", "docs");
const outputPath = join(import.meta.dirname, "..", "public", "llms-full.txt");
const siteUrl = "https://cli.archgate.dev";

/** Ordered sections — controls the output order for logical reading flow. */
const sections: Array<{ label: string; prefix: string }> = [
  { label: "Getting Started", prefix: "getting-started" },
  { label: "Core Concepts", prefix: "concepts" },
  { label: "Guides", prefix: "guides" },
  { label: "Reference", prefix: "reference" },
  { label: "Examples", prefix: "examples" },
];

/** Recursively collect all .mdx/.md files under a directory. */
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectFiles(full));
    } else if (entry.endsWith(".mdx") || entry.endsWith(".md")) {
      results.push(full);
    }
  }
  return results.sort();
}

/** Strip YAML frontmatter (--- ... ---) from markdown content. */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length) : content;
}

/** Extract title from YAML frontmatter. */
function extractTitle(content: string): string | null {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!match) return null;
  const titleMatch = match[0].match(/^title:\s*["']?(.+?)["']?\s*$/m);
  return titleMatch ? titleMatch[1] : null;
}

/** Strip JSX imports and component tags (keep content inside simple tags). */
function stripJsx(content: string): string {
  return content
    .replaceAll(/^import\s+.*$/gm, "") // import lines
    .replaceAll(/<[A-Z]\w+[^>]*\/>/g, "") // self-closing components
    .replaceAll(/<[A-Z]\w+[^>]*>|<\/[A-Z]\w+>/g, "") // opening/closing components
    .replaceAll(/:::.*\[.*\]\n?/g, "") // Starlight admonition openers (:::tip[...])
    .replaceAll(/^:::\s*$/gm, "") // Starlight admonition closers
    .replaceAll(/\n{3,}/g, "\n\n"); // collapse excess blank lines
}

/** Convert a file path to its URL path on the site. */
function fileToUrl(filePath: string): string {
  const rel = relative(docsDir, filePath)
    .replaceAll("\\", "/")
    .replace(/(?:\/)?index\.mdx?$/, "/")
    .replace(/\.mdx?$/, "/");
  const path = rel === "/" ? "/" : `/${rel}`;
  return `${siteUrl}${path}`;
}

// ── Build the output ────────────────────────────────────────────────

const header = readFileSync(
  join(import.meta.dirname, "..", "public", "llms.txt"),
  "utf-8"
);

const parts: string[] = [
  header.trim(),
  "",
  "---",
  "",
  "# Full documentation",
  "",
  "Below is the complete English documentation for Archgate CLI.",
  "",
];

// Process index page first
const indexPath = join(docsDir, "index.mdx");
const indexContent = readFileSync(indexPath, "utf-8");
const indexTitle = extractTitle(indexContent) ?? "Home";
const indexBody = stripJsx(stripFrontmatter(indexContent)).trim();
if (indexBody) {
  parts.push(`## ${indexTitle}`, "", `Source: ${fileToUrl(indexPath)}`, "");
  parts.push(indexBody, "", "---", "");
}

// Process each section in order
for (const section of sections) {
  const sectionDir = join(docsDir, section.prefix);
  let files: string[];
  try {
    files = collectFiles(sectionDir);
  } catch {
    continue; // section directory may not exist
  }

  // Skip pt-br files — English only
  const enFiles = files.filter((f) => !f.includes("pt-br"));
  if (enFiles.length === 0) continue;

  for (const file of enFiles) {
    const content = readFileSync(file, "utf-8");
    const title = extractTitle(content) ?? relative(docsDir, file);
    const body = stripJsx(stripFrontmatter(content)).trim();
    if (!body) continue;

    parts.push(
      `## ${section.label}: ${title}`,
      "",
      `Source: ${fileToUrl(file)}`,
      ""
    );
    parts.push(body, "", "---", "");
  }
}

const output = parts.join("\n").trimEnd() + "\n";
writeFileSync(outputPath, output, "utf-8");
console.log(
  `Generated llms-full.txt: ${outputPath} (${(Buffer.byteLength(output) / 1024).toFixed(1)} KB)`
);
