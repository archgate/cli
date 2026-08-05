/// <reference path="../rules.d.ts" />

// Highest allowed code point: 0x7F (DEL) and below is the ASCII range. Anything
// above 127 is decoded ambiguously by Windows PowerShell 5.1 on BOM-less files.
const MAX_ASCII = 0x7f;

/** Rewritten from commit messages on every release, so it is not hand-editable. */
const GENERATED_FILES = new Set(["CHANGELOG.md"]);

/**
 * A fenced code block delimiter: three or more backticks or tildes, indented at
 * most three spaces, capturing the run and whatever trails it. Everything
 * between a matching pair is literal content, where a backslash before a
 * backtick is exactly what the author meant.
 */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

interface FenceDelimiter {
  marker: string;
  length: number;
  /** An info string on an opener; a closer permits only whitespace here. */
  rest: string;
}

/** The fence delimiter this line carries, or null when it carries none. */
function fenceDelimiter(line: string): FenceDelimiter | null {
  const match = FENCE.exec(line);
  if (!match) return null;
  const run = match[1];
  return { marker: run[0], length: run.length, rest: match[2] };
}

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
 * Windows path. ARCH-021 covers why CommonMark ignores the escape.
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
  let openFence: FenceDelimiter | null = null;

  for (const [index, line] of lines.entries()) {
    if (inFrontmatter) {
      // The opening delimiter is line 0; the next bare `---` closes the block.
      if (index > 0 && line.trim() === "---") inFrontmatter = false;
      continue;
    }

    const delimiter = fenceDelimiter(line);
    if (openFence) {
      // A shorter run, the other marker, or a trailing info string is content:
      // a fence closes only on its own marker, at least as long, nothing after.
      const closes =
        delimiter !== null &&
        delimiter.marker === openFence.marker &&
        delimiter.length >= openFence.length &&
        delimiter.rest.trim() === "";
      if (closes) openFence = null;
      continue;
    }
    if (delimiter) {
      openFence = delimiter;
      continue;
    }

    const column = firstEscapeColumn(line);
    if (column !== null) findings.push({ line: index + 1, column });
  }

  return findings;
}

export default {
  rules: {
    "ascii-only-ps1": {
      description:
        "PowerShell (.ps1) files must be ASCII-only (Windows PowerShell 5.1 mis-decodes non-ASCII in BOM-less scripts)",
      severity: "error",
      async check(ctx) {
        const files = ctx.scopedFiles.filter((f) => f.endsWith(".ps1"));

        const checks = files.map(async (file) => {
          let content: string;
          try {
            content = await ctx.readFile(file);
          } catch {
            return;
          }
          const lines = content.split("\n");

          for (const [index, line] of lines.entries()) {
            for (let col = 0; col < line.length; col++) {
              const codePoint = line.codePointAt(col) ?? 0;
              if (codePoint <= MAX_ASCII) continue;

              const char = String.fromCodePoint(codePoint);
              ctx.report.violation({
                message: `Non-ASCII character "${char}" (U+${codePoint
                  .toString(16)
                  .toUpperCase()
                  .padStart(
                    4,
                    "0"
                  )}) at column ${col + 1} breaks Windows PowerShell 5.1 parsing`,
                file,
                line: index + 1,
                fix: "Replace with an ASCII equivalent (e.g. em-dash with `-`, curly quotes with straight quotes)",
              });
              break; // one report per line is enough
            }
          }
        });
        await Promise.all(checks);
      },
    },
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
