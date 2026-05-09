import { describe, expect, test } from "bun:test";

import fc from "fast-check";

import {
  AdrFrontmatterSchema,
  parseAdr,
  parseFrontmatter,
} from "../../src/formats/adr";

// ---------------------------------------------------------------------------
// Custom arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary that produces strings resembling kebab-case domain names. */
const domainArb = fc.oneof(
  fc.stringMatching(/^[a-z][a-z0-9-]{1,31}$/u),
  fc.constant(""),
  fc.constant("a"),
  fc.constant("BACKEND"),
  fc.constant("my domain"),
  fc.string({ minLength: 0, maxLength: 100 })
);

/** Arbitrary that builds a string resembling ADR frontmatter + body. */
const adrContentArb = fc
  .record({
    id: fc.oneof(
      fc.string({ minLength: 0, maxLength: 30 }),
      fc.constant("GEN-001")
    ),
    title: fc.string({ minLength: 0, maxLength: 60 }),
    domain: domainArb,
    rules: fc.oneof(fc.constant("true"), fc.constant("false"), fc.string()),
    body: fc.string({ minLength: 0, maxLength: 200 }),
    includeId: fc.boolean(),
    includeTitle: fc.boolean(),
    includeDomain: fc.boolean(),
    includeRules: fc.boolean(),
  })
  .map(({ id, title, domain, rules, body, ...flags }) => {
    const fields: string[] = [];
    if (flags.includeId) fields.push(`id: ${id}`);
    if (flags.includeTitle) fields.push(`title: ${title}`);
    if (flags.includeDomain) fields.push(`domain: ${domain}`);
    if (flags.includeRules) fields.push(`rules: ${rules}`);
    return `---\n${fields.join("\n")}\n---\n\n${body}`;
  });

const NUM_RUNS = 500;

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe("parseFrontmatter fuzz", () => {
  test("does not crash on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 300 }), (input) => {
        try {
          parseFrontmatter(input);
        } catch (e: unknown) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test("handles null bytes and control characters", () => {
    const inputs = [
      "id: \0",
      "title:  ",
      "domain: éñüßαβγ☃\u{1F680}​﻿ ",
      "rules: ﻿ true",
      "​id: GEN-001",
      "id: GEN-001\r\ntitle: test\r\nrules: true\r\ndomain: general",
    ];
    for (const input of inputs) {
      try {
        parseFrontmatter(input);
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(Error);
      }
    }
  });

  test("handles deeply nested YAML structures", () => {
    const inputs = [
      "a: {b: {c: {d: {e: {f: {g: 1}}}}}}",
      "a:\n  b:\n    c:\n      d:\n        e: 1",
      "a: [[[[[[1]]]]]]",
      "a: &anchor\n  b: 1\nc: *anchor",
    ];
    for (const input of inputs) {
      try {
        parseFrontmatter(input);
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(Error);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// parseAdr
// ---------------------------------------------------------------------------

describe("parseAdr fuzz", () => {
  test("does not crash on random ADR-shaped inputs", () => {
    fc.assert(
      fc.property(adrContentArb, (content) => {
        try {
          parseAdr(content, "fuzz.md");
        } catch (e: unknown) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test("does not crash on completely random strings", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (content) => {
        try {
          parseAdr(content, "random.md");
        } catch (e: unknown) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test("handles adversarial frontmatter delimiters", () => {
    const inputs = [
      "------\nid: GEN-001\n------",
      "---\n---",
      "---\n\n---",
      "---\r\nid: GEN-001\r\n---",
      "--- \nid: GEN-001\n---",
      "---\nid: GEN-001\n--- trailing",
      "---\nid: GEN-001\n---\n---\nid: GEN-002\n---",
      "\n---\nid: GEN-001\n---",
      " ---\nid: GEN-001\n---",
      "---\n".repeat(50),
    ];
    for (const input of inputs) {
      try {
        parseAdr(input, "adversarial.md");
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(Error);
      }
    }
  });

  test("handles YAML injection attempts", () => {
    const inputs = [
      '---\nid: "GEN-001\\nrules: true"\ntitle: test\ndomain: general\nrules: false\n---',
      "---\nid: !!python/object:os.system 'echo pwned'\ntitle: test\ndomain: general\nrules: true\n---",
      "---\nid: !<!tag> value\ntitle: test\ndomain: general\nrules: true\n---",
      "---\nid: &id GEN-001\ntitle: *id\ndomain: general\nrules: true\n---",
      "---\nid: |\n  multi\n  line\ntitle: test\ndomain: general\nrules: true\n---",
      "---\nid: >\n  folded\n  text\ntitle: test\ndomain: general\nrules: true\n---",
    ];
    for (const input of inputs) {
      try {
        const doc = parseAdr(input, "injection.md");
        expect(doc).toHaveProperty("frontmatter");
        expect(doc).toHaveProperty("body");
        expect(doc).toHaveProperty("filePath");
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(Error);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AdrFrontmatterSchema
// ---------------------------------------------------------------------------

describe("AdrFrontmatterSchema fuzz", () => {
  test("safeParse never throws on arbitrary objects", () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
          title: fc.oneof(
            fc.string(),
            fc.constant(null),
            // oxlint-disable-next-line no-useless-undefined -- intentional: fuzz with undefined
            fc.constant(undefined)
          ),
          domain: domainArb,
          rules: fc.oneof(fc.boolean(), fc.string(), fc.integer()),
          files: fc.oneof(
            fc.array(fc.string(), { maxLength: 10 }),
            fc.string(),
            // oxlint-disable-next-line no-useless-undefined -- intentional: fuzz with undefined
            fc.constant(undefined)
          ),
        }),
        (obj) => {
          const result = AdrFrontmatterSchema.safeParse(obj);
          expect(result).toHaveProperty("success");
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  test("safeParse never throws on completely arbitrary values", () => {
    fc.assert(
      fc.property(fc.anything(), (val) => {
        const result = AdrFrontmatterSchema.safeParse(val);
        expect(result).toHaveProperty("success");
      }),
      { numRuns: NUM_RUNS }
    );
  });

  test("handles extreme field values", () => {
    const cases = [
      { id: "", title: "", domain: "", rules: false },
      {
        id: "a".repeat(10_000),
        title: "b".repeat(10_000),
        domain: "c".repeat(10_000),
        rules: true,
      },
      { id: "\0\0\0", title: "\n\r\t", domain: "﻿​", rules: true },
      { id: 0, title: false, domain: [], rules: "yes" },
      { id: null, title: undefined, domain: NaN, rules: Infinity },
      { id: {}, title: [], domain: () => {}, rules: Symbol("test") },
    ];
    for (const c of cases) {
      const result = AdrFrontmatterSchema.safeParse(c);
      expect(result).toHaveProperty("success");
    }
  });
});
