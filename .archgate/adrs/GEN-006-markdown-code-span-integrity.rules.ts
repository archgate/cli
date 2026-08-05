/// <reference path="../rules.d.ts" />

/**
 * A fenced code block delimiter: three or more backticks or tildes, indented
 * at most three spaces. Everything between a matching pair is literal content,
 * where a backslash before a backtick is exactly what the author meant.
 */
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/u;

/** Rewritten from commit messages on every release, so it is not hand-editable. */
const GENERATED_FILES = new Set(["CHANGELOG.md"]);

/** Offset of the next run of exactly `length` backticks, or -1 if there is none. */
function findClosingRun(line: string, from: number, length: number): number {
  let i = from;
  while (i < line.length) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    let run = 0;
    while (line[i + run] === "`") run++;
    if (run === length) return i;
    i += run;
  }
  return -1;
}

/**
 * The 1-based column of the first backslash that precedes a backtick in this
 * line's text — the character to delete — or null when there is none. Walking
 * whole spans and inspecting only the text between them separates a mistaken
 * escape from a span whose content legitimately ends in a backslash, such as a
 * Windows path. GEN-006 covers why CommonMark ignores the escape.
 */
function firstEscapeColumn(line: string): number | null {
  let i = 0;
  while (i < line.length) {
    if (line[i] === "\\") {
      if (line[i + 1] === "`") return i + 1;
      // A backslash consumes the next character, `\\` included, so a literal
      // backslash before a span opener is not mistaken for an escaped tick.
      i += 2;
      continue;
    }
    if (line[i] !== "`") {
      i++;
      continue;
    }
    let run = 0;
    while (line[i + run] === "`") run++;
    const close = findClosingRun(line, i + run, run);
    // An unclosed run renders as literal text; resume scanning just past it.
    i = close === -1 ? i + run : close + run;
  }
  return null;
}

interface Finding {
  line: number;
  column: number;
}

/** Every offending line in a document, skipping frontmatter and fenced blocks. */
function scanDocument(content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");
  let inFrontmatter = lines[0]?.trim() === "---";
  let inFence = false;

  for (const [index, line] of lines.entries()) {
    if (inFrontmatter) {
      // The opening delimiter is line 0; the next bare `---` closes the block.
      if (index > 0 && line.trim() === "---") inFrontmatter = false;
      continue;
    }
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const column = firstEscapeColumn(line);
    if (column !== null) findings.push({ line: index + 1, column });
  }

  return findings;
}

export default {
  rules: {
    "no-escaped-backtick-in-markdown": {
      description:
        "Markdown must not escape a backtick with a backslash — CommonMark ignores the escape and the surrounding code spans re-pair incorrectly",
      severity: "error",
      async check(ctx) {
        const files = ctx.scopedFiles.filter(
          (f) =>
            (f.endsWith(".md") || f.endsWith(".mdx")) &&
            !GENERATED_FILES.has(f.split("/").pop() ?? f)
        );

        await Promise.all(
          files.map(async (file) => {
            let content: string;
            try {
              content = await ctx.readFile(file);
            } catch {
              return;
            }

            for (const { line, column } of scanDocument(content)) {
              ctx.report.violation({
                message: `Backslash at column ${column} tries to escape the backtick after it. CommonMark does not honour the escape, so that backtick closes a code span and the rest of the line renders with its spans shifted.`,
                file,
                line,
                fix: "Wrap the whole snippet in a longer delimiter — ``a `b` c`` — so the inner backticks need no escape, or move the inner command into a span of its own.",
              });
            }
          })
        );
      },
    },
  },
} satisfies RuleSet;
