/// <reference path="../rules.d.ts" />

// Section names `briefAdr` extracts, matched case-insensitively as the engine
// does. Keep in sync with `src/engine/context.ts`.
const BRIEFED_SECTIONS = ["Decision", "Do's and Don'ts"];

const ENGINE_CONTEXT_FILE = "src/engine/context.ts";

// Used when the engine source is absent, i.e. outside this repository.
const FALLBACK_MAX_SECTION_CHARS = 2000;

/**
 * Read the engine's cap so this rule and `briefAdr` cannot disagree.
 *
 * Falls back to the documented default ONLY when the engine file is absent.
 * A file that exists but cannot be read or does not declare the constant is an
 * error: silently assuming 2000 there could suppress a real overflow warning.
 *
 * @throws When the engine file exists but its cap cannot be determined.
 */
async function resolveCap(ctx: RuleContext): Promise<number> {
  const found = await ctx.glob(ENGINE_CONTEXT_FILE);
  if (found.length === 0) return FALLBACK_MAX_SECTION_CHARS;

  // Read errors propagate deliberately — see above.
  const source = await ctx.readFile(ENGINE_CONTEXT_FILE);
  const match = source.match(/DEFAULT_MAX_SECTION_CHARS\s*=\s*(\d+)/u);
  if (!match) {
    throw new Error(
      `${ENGINE_CONTEXT_FILE} exists but declares no DEFAULT_MAX_SECTION_CHARS; cannot verify the briefing budget`
    );
  }
  return Number(match[1]);
}

interface SectionSpan {
  name: string;
  length: number;
  line: number;
}

/**
 * Measure the briefed sections of an ADR body, mirroring `extractAdrSections`:
 * a `## ` heading opens a section, and its content is every following line up
 * to the next `## ` heading, trimmed.
 */
function measureBriefedSections(body: string): SectionSpan[] {
  const lines = body.split("\n");
  const spans: SectionSpan[] = [];

  let current: string | null = null;
  let startLine = 0;
  let buffer: string[] = [];

  const flush = () => {
    if (current !== null) {
      const match = BRIEFED_SECTIONS.find(
        (name) => name.toLowerCase() === current!.toLowerCase()
      );
      if (match) {
        spans.push({
          name: match,
          length: buffer.join("\n").trim().length,
          line: startLine,
        });
      }
    }
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^## (.+)$/u);
    if (heading) {
      flush();
      current = heading[1].trim();
      startLine = i + 1;
      continue;
    }
    buffer.push(lines[i]);
  }
  flush();

  return spans;
}

/** Strip YAML frontmatter so offsets match the body `briefAdr` receives. */
function splitBody(content: string): { body: string; offset: number } {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---/u);
  if (!match) return { body: content, offset: 0 };
  return {
    body: content.slice(match[0].length),
    offset: match[0].split("\n").length - 1,
  };
}

export default {
  rules: {
    "briefing-budget": {
      description:
        "ADR Decision and Do's and Don'ts sections must fit the review-context briefing cap, or the overflow must be documented as deliberate",
      severity: "warning",
      async check(ctx) {
        const cap = await resolveCap(ctx);
        const files = ctx.scopedFiles.filter((f) => f.endsWith(".md"));

        const checks = files.map(async (file) => {
          let content: string;
          try {
            content = await ctx.readFile(file);
          } catch (err) {
            // An unreadable ADR is unmeasured, not compliant — say so rather
            // than letting silence read as a pass.
            ctx.report.warning({
              message: `Could not read this ADR to measure its briefing budget: ${err instanceof Error ? err.message : String(err)}`,
              file,
              fix: "Ensure the file is readable, then re-run `archgate check --adr GEN-005`.",
            });
            return;
          }

          const { body, offset } = splitBody(content);
          for (const section of measureBriefedSections(body)) {
            if (section.length <= cap) continue;

            const over = section.length - cap;
            ctx.report.warning({
              message: `"${section.name}" is ${section.length} chars; review-context truncates at ${cap}, hiding ${over} chars from agent briefings`,
              file,
              line: section.line + offset,
              fix: "Move rationale to Context or Consequences, drop narration, and front-load the normative content. If no further cut is possible without losing a normative clause, record the overflow in this ADR's Compliance and Enforcement section (GEN-005).",
            });
          }
        });

        await Promise.all(checks);
      },
    },
  },
} satisfies RuleSet;
