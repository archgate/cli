/**
 * Utilities for mapping violation positions from transpiled JS back to
 * original TypeScript source, skipping matches in comments and strings.
 */

export interface SourcePos {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

/** Internal violation before remapping to original source positions. */
export interface RawViolation {
  message: string;
  /** Text to search for in the original source to find the true position. */
  searchText: string;
  /** Occurrence index (0-based) — the Nth match in transpiled = Nth in original code. */
  occurrence: number;
}

/**
 * Build a set of character ranges that are inside comments or string literals.
 * Used to filter out false matches when remapping violation positions.
 */
function buildNonCodeRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    // Line comment: // ... \n
    if (ch === "/" && next === "/") {
      const start = i;
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      ranges.push([start, i]);
      continue;
    }

    // Block comment: /* ... */
    if (ch === "/" && next === "*") {
      const start = i;
      i += 2;
      while (
        i < source.length - 1 &&
        !(source[i] === "*" && source[i + 1] === "/")
      )
        i++;
      i += 2; // skip */
      ranges.push([start, i]);
      continue;
    }

    // String literals: "...", '...', `...`
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const start = i;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2; // skip escaped char
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        // Template literal ${...} — skip the interpolation (it's code)
        if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
          ranges.push([start, i]);
          let depth = 1;
          i += 2;
          while (i < source.length && depth > 0) {
            if (source[i] === "{") depth++;
            else if (source[i] === "}") depth--;
            if (depth > 0) i++;
          }
          i++; // skip closing }
          continue;
        }
        i++;
      }
      ranges.push([start, i]);
      continue;
    }

    i++;
  }
  return ranges;
}

/**
 * Check if a character offset falls inside any non-code range.
 */
function isInNonCode(offset: number, ranges: Array<[number, number]>): boolean {
  for (const [start, end] of ranges) {
    if (offset >= start && offset < end) return true;
    if (start > offset) break; // ranges are sorted by start
  }
  return false;
}

/**
 * Find all code-only occurrences of `needle` in `source`, skipping
 * matches inside comments and string literals.
 */
function findCodeOccurrences(
  source: string,
  needle: string,
  nonCodeRanges: Array<[number, number]>
): SourcePos[] {
  const results: SourcePos[] = [];
  let idx = 0;
  while (true) {
    const found = source.indexOf(needle, idx);
    if (found === -1) break;

    if (isInNonCode(found, nonCodeRanges)) {
      idx = found + 1;
      continue;
    }

    let line = 1;
    let lastNewline = -1;
    for (let i = 0; i < found; i++) {
      if (source[i] === "\n") {
        line++;
        lastNewline = i;
      }
    }
    const column = found - lastNewline - 1;

    let endLine = line;
    let endLastNewline = lastNewline;
    for (let i = found; i < found + needle.length; i++) {
      if (source[i] === "\n") {
        endLine++;
        endLastNewline = i;
      }
    }
    const endColumn = found + needle.length - endLastNewline - 1;

    results.push({ line, column, endLine, endColumn });
    idx = found + 1;
  }
  return results;
}

/**
 * Remap violations from transpiled positions to original source positions.
 * Each violation carries a searchText and occurrence index. We find the Nth
 * code-only occurrence of that text in the original source to get the true
 * position, skipping matches inside comments and string literals.
 */
export function remapViolations(
  original: string,
  rawViolations: RawViolation[]
): Array<{ message: string } & SourcePos> {
  const nonCodeRanges = buildNonCodeRanges(original);
  const occurrenceCache = new Map<string, SourcePos[]>();

  return rawViolations.map((rv) => {
    let positions = occurrenceCache.get(rv.searchText);
    if (!positions) {
      positions = findCodeOccurrences(original, rv.searchText, nonCodeRanges);
      occurrenceCache.set(rv.searchText, positions);
    }

    const pos = positions[rv.occurrence];
    if (pos) {
      return { message: rv.message, ...pos };
    }
    return {
      message: rv.message,
      line: 0,
      column: 0,
      endLine: 0,
      endColumn: 0,
    };
  });
}
