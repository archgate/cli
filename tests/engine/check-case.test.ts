// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { checkCase } from "../../src/engine/check-case";
import type { CaseScheme } from "../../src/formats/rules";

describe("checkCase", () => {
  const cases: Record<CaseScheme, { pass: string[]; fail: string[] }> = {
    "kebab-case": {
      pass: ["adr", "writing-rules", "2fa-setup", "v2-api", "a-b-c-1"],
      fail: [
        "Writing-Rules",
        "writing_rules",
        "writing--rules",
        "-leading",
        "trailing-",
        "with space",
        "camelCase",
      ],
    },
    camelCase: {
      pass: ["value", "checkCase", "utf8ToUtf16", "parseURL", "a"],
      fail: ["CheckCase", "check_case", "check-case", "2fast", "check case"],
    },
    PascalCase: {
      pass: ["Value", "CheckCase", "HTTPServer", "Utf8Codec", "A"],
      fail: ["checkCase", "Check_Case", "Check-Case", "1Value", "Check Case"],
    },
    snake_case: {
      pass: ["value", "check_case", "utf8_to_utf16", "2fa_setup"],
      fail: [
        "Check_Case",
        "check-case",
        "check__case",
        "_leading",
        "trailing_",
        "SCREAMING",
      ],
    },
    SCREAMING_SNAKE_CASE: {
      pass: ["VALUE", "CHECK_CASE", "UTF8_TO_UTF16", "V2"],
      fail: [
        "value",
        "Check_Case",
        "CHECK-CASE",
        "CHECK__CASE",
        "_LEADING",
        "TRAILING_",
      ],
    },
  };

  for (const [scheme, { pass, fail }] of Object.entries(cases) as [
    CaseScheme,
    { pass: string[]; fail: string[] },
  ][]) {
    test(`${scheme}: accepts conforming strings`, () => {
      for (const value of pass) {
        expect(
          checkCase(value, scheme),
          `"${value}" should match ${scheme}`
        ).toBe(true);
      }
    });

    test(`${scheme}: rejects non-conforming strings`, () => {
      for (const value of fail) {
        expect(
          checkCase(value, scheme),
          `"${value}" should NOT match ${scheme}`
        ).toBe(false);
      }
    });
  }

  test("empty string matches no scheme", () => {
    for (const scheme of Object.keys(cases) as CaseScheme[]) {
      expect(checkCase("", scheme)).toBe(false);
    }
  });

  test("non-ASCII letters are rejected", () => {
    expect(checkCase("café-menu", "kebab-case")).toBe(false);
    expect(checkCase("naïveCase", "camelCase")).toBe(false);
  });

  test("unknown scheme throws instead of silently returning false", () => {
    expect(() => checkCase("value", "Train-Case" as CaseScheme)).toThrow(
      /Unknown case scheme "Train-Case"/u
    );
  });

  test("inherited property names are unknown schemes, not TypeErrors", () => {
    // A truthiness guard would let these through: they resolve to functions on
    // Object.prototype, then blow up on `.test()` instead of reporting the
    // documented unknown-scheme error.
    for (const inherited of [
      "constructor",
      "toString",
      "hasOwnProperty",
      "valueOf",
      "__proto__",
    ]) {
      expect(
        () => checkCase("value", inherited as CaseScheme),
        `"${inherited}" should report an unknown scheme`
      ).toThrow(new RegExp(`Unknown case scheme "${inherited}"`, "u"));
    }
  });
});
