// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import fc from "fast-check";

import {
  DomainNameSchema,
  DomainPrefixSchema,
  PathsConfigSchema,
  ProjectConfigSchema,
} from "../../src/formats/project-config";

const NUM_RUNS = 500;

// ---------------------------------------------------------------------------
// DomainNameSchema
// ---------------------------------------------------------------------------

describe("DomainNameSchema fuzz", () => {
  test("safeParse never throws on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (input) => {
        const result = DomainNameSchema.safeParse(input);
        expect(result).toHaveProperty("success");
      }),
      { numRuns: NUM_RUNS }
    );
  });

  describe("boundary cases for length constraints (min 2, max 32)", () => {
    test.each([
      ["", false], // too short
      ["a", false], // 1 char — too short
      ["ab", true], // 2 chars — minimum
      ["a".repeat(32), true], // 32 chars — maximum
      ["a".repeat(33), false], // 33 chars — over limit
      ["a".repeat(1000), false],
    ] as const)("%p -> success=%p", (input, expectSuccess) => {
      expect(DomainNameSchema.safeParse(input).success).toBe(expectSuccess);
    });
  });

  describe("regex boundary cases for kebab-case", () => {
    test.each([
      ["backend", true], // valid
      ["ml-ops", true], // valid
      ["a1", true], // valid — letter then digit
      ["1abc", false], // invalid — starts with digit
      ["-abc", false], // invalid — starts with hyphen
      ["abc-", true], // valid — ends with hyphen (regex allows it)
      ["ABC", false], // invalid — uppercase
      ["aB", false], // invalid — mixed case
      ["ab cd", false], // invalid — space
      ["ab_cd", false], // invalid — underscore
      ["ab.cd", false], // invalid — dot
      ["ab--cd", true], // valid — double hyphen
      ["a-b-c-d-e-f", true], // valid — many hyphens
    ] as const)("%p -> success=%p", (input, expectSuccess) => {
      expect(DomainNameSchema.safeParse(input).success).toBe(expectSuccess);
    });
  });

  test("rejects non-string types", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          // oxlint-disable-next-line no-useless-undefined -- intentional: fuzz with undefined
          fc.constant(undefined),
          fc.array(fc.anything()),
          fc.dictionary(fc.string(), fc.anything())
        ),
        (input) => {
          const result = DomainNameSchema.safeParse(input);
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

// ---------------------------------------------------------------------------
// DomainPrefixSchema
// ---------------------------------------------------------------------------

describe("DomainPrefixSchema fuzz", () => {
  test("safeParse never throws on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 20 }), (input) => {
        const result = DomainPrefixSchema.safeParse(input);
        expect(result).toHaveProperty("success");
      }),
      { numRuns: NUM_RUNS }
    );
  });

  describe("boundary cases for length constraints (min 2, max 10)", () => {
    test.each([
      ["", false],
      ["A", false], // 1 char — too short
      ["AB", true], // 2 chars — minimum
      ["A".repeat(10), true], // 10 chars — maximum
      ["A".repeat(11), false], // 11 chars — over limit
      ["A".repeat(1000), false],
    ] as const)("%p -> success=%p", (input, expectSuccess) => {
      expect(DomainPrefixSchema.safeParse(input).success).toBe(expectSuccess);
    });
  });

  describe("regex boundary cases for uppercase pattern", () => {
    test.each([
      ["GEN", true], // valid
      ["MLOPS", true], // valid
      ["ML_OPS", true], // valid — underscore allowed
      ["A1", true], // valid — letter then digit
      ["1ABC", false], // invalid — starts with digit
      ["_ABC", false], // invalid — starts with underscore
      ["abc", false], // invalid — lowercase
      ["Ab", false], // invalid — mixed case
      ["AB CD", false], // invalid — space
      ["AB-CD", false], // invalid — hyphen
    ] as const)("%p -> success=%p", (input, expectSuccess) => {
      expect(DomainPrefixSchema.safeParse(input).success).toBe(expectSuccess);
    });
  });
});

// ---------------------------------------------------------------------------
// ProjectConfigSchema
// ---------------------------------------------------------------------------

describe("ProjectConfigSchema fuzz", () => {
  test("safeParse never throws on arbitrary config-shaped objects", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 15 }),
          fc.string({ minLength: 1, maxLength: 8 }),
          { minKeys: 0, maxKeys: 10 }
        ),
        (domains) => {
          const result = ProjectConfigSchema.safeParse({ domains });
          expect(result).toHaveProperty("success");
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  test("safeParse never throws on completely arbitrary values", () => {
    fc.assert(
      fc.property(fc.anything(), (val) => {
        const result = ProjectConfigSchema.safeParse(val);
        expect(result).toHaveProperty("success");
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test("handles extreme domain counts", () => {
    const domains: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      domains[`domain${String.fromCodePoint(97 + (i % 26))}${i}`] = `D${i}`;
    }
    const result = ProjectConfigSchema.safeParse({ domains });
    expect(result).toHaveProperty("success");
  });

  test.each([
    { domains: null },
    { domains: "not-an-object" },
    { domains: 42 },
    { domains: [] },
    { domains: true },
    { domains: { valid: 123 } },
    { domains: { valid: null } },
    { domains: { valid: undefined } },
    { domains: { "": "" } },
  ])("rejects domains shaped as %j", (c) => {
    expect(ProjectConfigSchema.safeParse(c).success).toBe(false);
  });

  test.each([undefined, {}, { domains: {} }])(
    "defaults domains to {} for %j",
    (input) => {
      const result = ProjectConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.domains).toEqual({});
      }
    }
  );

  test.each([
    { domains: {}, paths: { adrs: "docs/adrs" } },
    { domains: {}, paths: { rules: "custom/rules" } },
    { domains: {}, paths: { adrs: "docs/adrs", rules: "docs/adrs" } },
    { domains: {}, paths: {} },
  ])("accepts %j", (c) => {
    expect(ProjectConfigSchema.safeParse(c).success).toBe(true);
  });

  test.each([
    { domains: {}, paths: { adrs: "/absolute/path" } },
    { domains: {}, paths: { rules: "/etc/rules" } },
    { domains: {}, paths: { adrs: "C:\\absolute\\path" } },
  ])("rejects absolute path %j", (c) => {
    expect(ProjectConfigSchema.safeParse(c).success).toBe(false);
  });

  test.each([
    { domains: {}, paths: { adrs: "../escape" } },
    { domains: {}, paths: { adrs: "docs/../../escape" } },
    { domains: {}, paths: { rules: ".." } },
  ])("rejects '..' path segments in %j", (c) => {
    expect(ProjectConfigSchema.safeParse(c).success).toBe(false);
  });

  test.each([
    { domains: {}, strict: true },
    { domains: {}, strict: false },
    { domains: {} },
  ])("accepts strict %j", (c) => {
    expect(ProjectConfigSchema.safeParse(c).success).toBe(true);
  });

  test.each([
    { domains: {}, strict: "yes" },
    { domains: {}, strict: 1 },
    { domains: {}, strict: null },
    { domains: {}, strict: "true" },
  ])("rejects non-boolean strict %j", (c) => {
    expect(ProjectConfigSchema.safeParse(c).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PathsConfigSchema
// ---------------------------------------------------------------------------

describe("PathsConfigSchema fuzz", () => {
  test("safeParse never throws on arbitrary strings for adrs/rules", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (input) => {
        const result = PathsConfigSchema.safeParse({
          adrs: input,
          rules: input,
        });
        expect(result).toHaveProperty("success");
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test.each(["docs/adrs", "custom", "a/b/c/d", "src/governance/adrs", "adrs"])(
    "accepts %s as adrs path",
    (p) => {
      expect(PathsConfigSchema.safeParse({ adrs: p }).success).toBe(true);
    }
  );

  test.each(["/root", "\\root", "C:\\path", "D:/path"])(
    "rejects absolute path %s",
    (p) => {
      expect(PathsConfigSchema.safeParse({ adrs: p }).success).toBe(false);
    }
  );

  test.each(["..", "../foo", "foo/../bar", "foo/.."])(
    "rejects path with '..' segment %s",
    (p) => {
      expect(PathsConfigSchema.safeParse({ adrs: p }).success).toBe(false);
    }
  );

  test("rejects empty strings", () => {
    const result = PathsConfigSchema.safeParse({ adrs: "" });
    expect(result.success).toBe(false);
  });
});
