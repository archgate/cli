// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { parseModule, parseScript } from "meriyah";

import type { CommentToken } from "../formats/rules";

/**
 * ESTree Program produced by meriyah's `parseModule`/`parseScript` — the
 * parser's own richly-typed return. Distinct from the hand-authored,
 * self-contained `EsTreeProgram` in `src/formats/rules.ts`, which is the
 * public shape `.rules.ts` authors see through the ambient `rules.d.ts`.
 */
export type MeriyahProgram = ReturnType<typeof parseModule>;

/**
 * Parse JavaScript source into an ESTree AST via meriyah. The single
 * sanctioned meriyah call site per ARCH-022, shared by `rule-scanner.ts` and
 * `ctx.ast()` in `runner.ts`. `sourceType: "script"` parses sloppy-mode
 * CommonJS with `globalReturn` (Node allows top-level `return` in CJS).
 * Throws on syntax errors; callers decide how to surface them.
 */
export function parseJsModule(
  source: string,
  options?: { jsx?: boolean; sourceType?: "module" | "script" }
): MeriyahProgram {
  const jsx = options?.jsx === true;
  if (options?.sourceType === "script") {
    return parseScript(source, {
      next: true,
      loc: true,
      globalReturn: true,
      jsx,
    });
  }
  return parseModule(source, { next: true, loc: true, module: true, jsx });
}

/**
 * Extract `//` line and `/* … *​/` block comments from TypeScript/JavaScript
 * source, with delimiter-stripped text and original-source positions (0-based
 * columns, matching ESTree `loc` and Python `col_offset`). String and
 * template literals are skipped; regex literals are NOT tracked — a known
 * blind spot shared with the scanner in `source-positions.ts`.
 */
export function extractJsComments(source: string): CommentToken[] {
  const comments: CommentToken[] = [];
  let i = 0;
  let line = 1;
  let col = 0;
  const advance = (n: number) => {
    for (let k = 0; k < n; k++) {
      if (source[i] === "\n") {
        line++;
        col = 0;
      } else {
        col++;
      }
      i++;
    }
  };

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '"' || ch === "'" || ch === "`") {
      // Skip the string/template literal wholesale (with escape handling).
      advance(1);
      while (i < source.length && source[i] !== ch) {
        advance(source[i] === "\\" ? 2 : 1);
      }
      advance(1); // closing quote
      continue;
    }

    if (ch === "/" && next === "/") {
      const start = { line, column: col };
      const from = i + 2;
      // Stop on CR as well as LF so a Windows `\r\n` line ending does not leave
      // a trailing `\r` in the comment value — ESTree/acorn exclude all line
      // terminators from the value. The `\r` is consumed by the outer loop.
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") {
        advance(1);
      }
      comments.push({
        type: "line",
        value: source.slice(from, i),
        loc: { start, end: { line, column: col } },
      });
      continue;
    }

    if (ch === "/" && next === "*") {
      const start = { line, column: col };
      const from = i + 2;
      advance(2);
      while (
        i < source.length &&
        !(source[i] === "*" && source[i + 1] === "/")
      ) {
        advance(1);
      }
      const to = i;
      advance(2); // closing */
      comments.push({
        type: "block",
        value: source.slice(from, to),
        loc: { start, end: { line, column: col } },
      });
      continue;
    }

    advance(1);
  }

  return comments;
}

/**
 * Parse TypeScript/JavaScript *source* into an ESTree AST for `ctx.ast()`,
 * selecting the mode from the file extension: TS goes through
 * `Bun.Transpiler` (ARCH-022: `loc` is transpiled-relative), `.cts`/`.cjs`
 * parse as sloppy scripts, `.jsx` enables JSX. `collectComments` attaches
 * `comments` read from the ORIGINAL source, carrying original positions.
 */
export function parseTsOrJsSource(
  language: "typescript" | "javascript",
  path: string,
  source: string,
  collectComments = false
): MeriyahProgram {
  const lower = path.toLowerCase();
  let tree: MeriyahProgram;
  if (language === "typescript") {
    const loader = lower.endsWith(".tsx") ? "tsx" : "ts";
    const js = new Bun.Transpiler({ loader }).transformSync(source);
    tree = parseJsModule(js, {
      sourceType: lower.endsWith(".cts") ? "script" : "module",
    });
  } else {
    tree = parseJsModule(source, {
      jsx: lower.endsWith(".jsx"),
      sourceType: lower.endsWith(".cjs") ? "script" : "module",
    });
  }
  if (collectComments) {
    (tree as { comments?: CommentToken[] }).comments =
      extractJsComments(source);
  }
  return tree;
}
