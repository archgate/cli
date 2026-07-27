// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { checkCase } from "../../src/engine/check-case";
import type { CaseScheme } from "../../src/formats/rules";

/**
 * `Object.keys`/`Object.entries` widen a `Record<K, V>`'s keys to `string`
 * even when `K` is a finite string-literal union — a well-known TypeScript
 * stdlib typing gap, not an actual unsafe read: a value statically typed
 * `Record<K, V>` has exactly `K`'s members as its runtime keys.
 */
function schemeKeys<K extends string, V>(record: Record<K, V>): K[] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return Object.keys(record) as K[];
}

function schemeEntries<K extends string, V>(record: Record<K, V>): [K, V][] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return Object.entries(record) as [K, V][];
}

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

  const passCases = schemeEntries(cases).flatMap(([scheme, { pass }]) =>
    pass.map((value) => ({ scheme, value }))
  );

  const failCases = schemeEntries(cases).flatMap(([scheme, { fail }]) =>
    fail.map((value) => ({ scheme, value }))
  );

  test.each(passCases)(
    "$scheme accepts conforming string $value",
    ({ scheme, value }) => {
      expect(checkCase(value, scheme)).toBe(true);
    }
  );

  test.each(failCases)(
    "$scheme rejects non-conforming string $value",
    ({ scheme, value }) => {
      expect(checkCase(value, scheme)).toBe(false);
    }
  );

  test("empty string matches no scheme", () => {
    for (const scheme of schemeKeys(cases)) {
      expect(checkCase("", scheme)).toBe(false);
    }
  });

  test("non-ASCII letters are rejected", () => {
    expect(checkCase("café-menu", "kebab-case")).toBe(false);
    expect(checkCase("naïveCase", "camelCase")).toBe(false);
  });

  test("unknown scheme throws instead of silently returning false", () => {
    // Deliberately invalid CaseScheme: exercises the runtime guard against a
    // scheme value the type system itself would otherwise rule out.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    expect(() => checkCase("value", "Train-Case" as CaseScheme)).toThrow(
      /Unknown case scheme "Train-Case"/u
    );
  });

  // A truthiness guard would let these through: they resolve to functions on
  // Object.prototype, then blow up on `.test()` instead of reporting the
  // documented unknown-scheme error.
  test.each([
    "constructor",
    "toString",
    "hasOwnProperty",
    "valueOf",
    "__proto__",
  ])("%s is reported as an unknown scheme", (inherited) => {
    // Same deliberate-invalid-scheme rationale as above.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    expect(() => checkCase("value", inherited as CaseScheme)).toThrow(
      new RegExp(`Unknown case scheme "${inherited}"`, "u")
    );
  });
});
