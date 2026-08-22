// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { truncatePreview } from "../../src/helpers/session-context";

/**
 * `truncatePreview`'s Unicode boundary behaviour; the reader paths that call it
 * are covered in `session-context.test.ts`.
 */
describe("truncatePreview", () => {
  // Exact expected output, not just a trailing "...": assertions that only
  // check the suffix pass for a helper that returns "..." and nothing else.
  test.each([
    ["returns text unchanged under the limit", "hello", 10, "hello"],
    ["returns text unchanged exactly at the limit", "hello", 5, "hello"],
    ["truncates ascii at the column boundary", "abcdef", 5, "abcde..."],
    // A code-unit cut here would emit a lone surrogate.
    ["keeps a surrogate pair whole", "ab\u{1F44D}cd", 3, "ab\u{1F44D}..."],
    [
      "keeps a ZWJ sequence whole",
      "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}xy",
      2,
      "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}...",
    ],
    ["keeps a combining mark with its base", "école", 2, "éc..."],
    // Full-width characters cost two columns each, so 4 columns is 2 of them.
    ["counts a full-width character as two columns", "日本語", 4, "日本..."],
  ])("%s", (_name, input, max, expected) => {
    expect(truncatePreview(input, max)).toBe(expected);
  });

  // A grapheme straddling the boundary is kept whole rather than cut, so the
  // result can exceed `max` by one column. Preferred over a lone surrogate.
  test("keeps a straddling grapheme, overshooting the column budget", () => {
    const result = truncatePreview("ab\u{1F44D}cd", 3);
    expect(result).toBe("ab\u{1F44D}...");
    expect(Bun.stringWidth(result.slice(0, -3))).toBe(4);
  });

  test.each([
    ["under the limit", "hello", 10],
    ["at the limit", "hello", 5],
  ])("appends no ellipsis when %s", (_name, input, max) => {
    expect(truncatePreview(input, max)).not.toEndWith("...");
  });

  // Truncation detection relies on an untruncated input coming back
  // identical — `sliced === text` is what distinguishes the two cases.
  test.each([
    ["ascii", "hello"],
    ["emoji", "ab\u{1F44D}cd"],
    ["full-width", "日本語"],
    ["combining mark", "école"],
    ["empty", ""],
  ])("returns the identical string for %s under the limit", (_name, input) => {
    expect(truncatePreview(input, 100)).toBe(input);
  });
});
