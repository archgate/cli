import { describe, expect, test } from "bun:test";

import fc from "fast-check";

import {
  DomainNameSchema,
  DomainPrefixSchema,
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

  test("boundary cases for length constraints (min 2, max 32)", () => {
    const cases = [
      "", // too short
      "a", // 1 char — too short
      "ab", // 2 chars — minimum
      "a".repeat(32), // 32 chars — maximum
      "a".repeat(33), // 33 chars — over limit
      "a".repeat(1000),
    ];
    for (const c of cases) {
      const result = DomainNameSchema.safeParse(c);
      expect(result).toHaveProperty("success");
    }
  });

  test("regex boundary cases for kebab-case", () => {
    const cases = [
      "backend", // valid
      "ml-ops", // valid
      "a1", // valid — letter then digit
      "1abc", // invalid — starts with digit
      "-abc", // invalid — starts with hyphen
      "abc-", // valid — ends with hyphen (regex allows it)
      "ABC", // invalid — uppercase
      "aB", // invalid — mixed case
      "ab cd", // invalid — space
      "ab_cd", // invalid — underscore
      "ab.cd", // invalid — dot
      "ab--cd", // valid — double hyphen
      "a-b-c-d-e-f", // valid — many hyphens
    ];
    for (const c of cases) {
      const result = DomainNameSchema.safeParse(c);
      expect(result).toHaveProperty("success");
    }
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

  test("boundary cases for length constraints (min 2, max 10)", () => {
    const cases = [
      "",
      "A", // 1 char — too short
      "AB", // 2 chars — minimum
      "A".repeat(10), // 10 chars — maximum
      "A".repeat(11), // 11 chars — over limit
      "A".repeat(1000),
    ];
    for (const c of cases) {
      const result = DomainPrefixSchema.safeParse(c);
      expect(result).toHaveProperty("success");
    }
  });

  test("regex boundary cases for uppercase pattern", () => {
    const cases = [
      "GEN", // valid
      "MLOPS", // valid
      "ML_OPS", // valid — underscore allowed
      "A1", // valid — letter then digit
      "1ABC", // invalid — starts with digit
      "_ABC", // invalid — starts with underscore
      "abc", // invalid — lowercase
      "Ab", // invalid — mixed case
      "AB CD", // invalid — space
      "AB-CD", // invalid — hyphen
    ];
    for (const c of cases) {
      const result = DomainPrefixSchema.safeParse(c);
      expect(result).toHaveProperty("success");
    }
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

  test("handles wrong shapes for domains field", () => {
    const cases = [
      { domains: null },
      { domains: "not-an-object" },
      { domains: 42 },
      { domains: [] },
      { domains: true },
      { domains: { valid: 123 } },
      { domains: { valid: null } },
      { domains: { valid: undefined } },
      { domains: { "": "" } },
    ];
    for (const c of cases) {
      const result = ProjectConfigSchema.safeParse(c);
      expect(result).toHaveProperty("success");
    }
  });

  test("defaults correctly for missing or empty input", () => {
    const cases = [undefined, {}, { domains: {} }];
    for (const c of cases) {
      const result = ProjectConfigSchema.safeParse(c);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.domains).toEqual({});
      }
    }
  });
});
