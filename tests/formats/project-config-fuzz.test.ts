import { describe, expect, test } from "bun:test";

import {
  DomainNameSchema,
  DomainPrefixSchema,
  ProjectConfigSchema,
} from "../../src/formats/project-config";

// ---------------------------------------------------------------------------
// Generators — hand-rolled to avoid adding a devDependency (ARCH-006)
// ---------------------------------------------------------------------------

const ASCII = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SPECIAL = "!@#$%^&*()_+-=[]{}|;':\",./<>?\\\n\r\t ";

function randomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function randomString(maxLen: number, charset = ASCII + SPECIAL): string {
  const len = randomInt(maxLen);
  return Array.from(
    { length: len },
    () => charset[randomInt(charset.length)]
  ).join("");
}

// ---------------------------------------------------------------------------
// DomainNameSchema fuzz
// ---------------------------------------------------------------------------

const ITERATIONS = 500;

describe("DomainNameSchema fuzz", () => {
  test(`validates ${ITERATIONS} random strings without crashing`, () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = randomString(50);
      const result = DomainNameSchema.safeParse(input);
      expect(result).toHaveProperty("success");
    }
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
      "ñ", // invalid — non-ASCII
      "a\n", // invalid — newline
    ];
    for (const c of cases) {
      const result = DomainNameSchema.safeParse(c);
      expect(result).toHaveProperty("success");
    }
  });

  test("handles non-string types", () => {
    const cases = [
      null,
      undefined,
      0,
      false,
      true,
      [],
      {},
      NaN,
      Infinity,
      Symbol("test"),
      () => {},
    ];
    for (const c of cases) {
      const result = DomainNameSchema.safeParse(c);
      expect(result).toHaveProperty("success");
      expect(result.success).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// DomainPrefixSchema fuzz
// ---------------------------------------------------------------------------

describe("DomainPrefixSchema fuzz", () => {
  test(`validates ${ITERATIONS} random strings without crashing`, () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const input = randomString(20);
      const result = DomainPrefixSchema.safeParse(input);
      expect(result).toHaveProperty("success");
    }
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
// ProjectConfigSchema fuzz
// ---------------------------------------------------------------------------

describe("ProjectConfigSchema fuzz", () => {
  test(`validates ${ITERATIONS} random config objects without crashing`, () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const domainCount = randomInt(10);
      const domains: Record<string, unknown> = {};

      for (let j = 0; j < domainCount; j++) {
        const key =
          Math.random() > 0.5
            ? randomString(15, "abcdefghijklmnopqrstuvwxyz0123456789-")
            : randomString(15);
        const value =
          Math.random() > 0.5
            ? randomString(8, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")
            : randomString(8);
        domains[key] = value;
      }

      const config: Record<string, unknown> = { domains };

      // Randomly add extra top-level keys
      if (Math.random() > 0.7) {
        config[randomString(10)] = randomString(20);
      }

      const result = ProjectConfigSchema.safeParse(config);
      expect(result).toHaveProperty("success");
    }
  });

  test("handles extreme domain counts", () => {
    // Many domains
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
      { domains: { valid: 123 } }, // value is number, not string
      { domains: { valid: null } }, // value is null
      { domains: { valid: undefined } }, // value is undefined
      { domains: { "": "" } }, // empty keys/values
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
