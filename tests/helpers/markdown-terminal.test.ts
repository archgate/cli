// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { renderMarkdownForTerminal } from "../../src/helpers/markdown-terminal";

/**
 * Assertions compare visible text, not ANSI codes: `styleText` emits none when
 * stdout is not a TTY, which is how the suite runs, and pinning escape
 * sequences would assert Node's palette rather than this module's layout.
 */
function render(markdown: string): string {
  return renderMarkdownForTerminal(markdown);
}

describe("renderMarkdownForTerminal", () => {
  describe("block structure", () => {
    test("keeps heading text and marks its level", () => {
      expect(render("## Context")).toContain("## Context");
    });

    test("renders a paragraph as its text", () => {
      expect(render("Just a sentence.").trim()).toBe("Just a sentence.");
    });

    test("bullets an unordered list", () => {
      const out = render("- alpha\n- beta");
      expect(out).toContain("- alpha");
      expect(out).toContain("- beta");
    });

    test("numbers an ordered list from its start attribute", () => {
      const out = render("3. third\n4. fourth");
      expect(out).toContain("3. third");
      expect(out).toContain("4. fourth");
    });

    test("indents a fenced code block under its language label", () => {
      const out = render("```ts\nconst x = 1;\n```");
      expect(out).toContain("ts");
      expect(out).toContain("    const x = 1;");
    });

    test("prefixes a blockquote", () => {
      expect(render("> careful")).toContain("│ careful");
    });

    test("draws a horizontal rule", () => {
      expect(render("---")).toContain("─".repeat(60));
    });

    test("keeps a link's href reachable alongside its text", () => {
      const out = render("[docs](https://cli.archgate.dev)");
      expect(out).toContain("docs");
      expect(out).toContain("(https://cli.archgate.dev)");
    });
  });

  describe("tables", () => {
    const table = "| Package | Purpose |\n| --- | --- |\n| zod | Schemas |\n";

    test("aligns every row to the same width", () => {
      const lines = render(table).trim().split("\n");
      const widths = new Set(lines.map((line) => Bun.stringWidth(line)));
      // Header, rule, and body row all pad to one grid.
      expect(widths.size).toBe(1);
    });

    test("keeps each cell's text", () => {
      const out = render(table);
      for (const cell of ["Package", "Purpose", "zod", "Schemas"]) {
        expect(out).toContain(cell);
      }
    });

    test("sizes columns by terminal width, not code-unit length", () => {
      const wide = "| a | b |\n| --- | --- |\n| 決定記録 | x |\n";
      const lines = render(wide).trim().split("\n");
      expect(new Set(lines.map((l) => Bun.stringWidth(l))).size).toBe(1);
    });
  });

  describe("inline and edge cases", () => {
    test("keeps emphasis, strong, and code text", () => {
      const out = render("A **bold** and _soft_ `call()`.");
      expect(out).toContain("bold");
      expect(out).toContain("soft");
      expect(out).toContain("call()");
    });

    test("drops raw HTML rather than printing markup", () => {
      const out = render("before\n\n<!-- archgate-ignore -->\n\nafter");
      expect(out).toContain("before");
      expect(out).toContain("after");
      expect(out).not.toContain("archgate-ignore");
    });

    test("leaves no marker placeholder in the output", () => {
      // The list marker is injected via a control-character placeholder; one
      // surviving into the output would print as a stray glyph.
      const out = render("- a\n\n1. b\n\nparagraph");
      expect(out).not.toContain(String.fromCodePoint(0x11));
      expect(out).not.toContain(String.fromCodePoint(0x1f));
      expect(out).not.toContain(String.fromCodePoint(0x1e));
    });

    test("ends with exactly one newline", () => {
      expect(render("text\n\n\n")).toEndWith("text\n");
    });

    test("renders an empty document without throwing", () => {
      expect(render("")).toBe("\n");
    });
  });
});
