import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { parseAdr, parseFrontmatter } from "../../src/formats/adr";

const FIXTURES = join(import.meta.dir, "..", "fixtures");

describe("parseFrontmatter", () => {
  test("parses simple key-value pairs", () => {
    const result = parseFrontmatter("id: GEN-001\ntitle: Test\nrules: false");
    expect(result.id).toBe("GEN-001");
    expect(result.title).toBe("Test");
    expect(result.rules).toBe(false);
  });

  test("parses inline arrays", () => {
    const result = parseFrontmatter('files: ["src/**/*.ts", "lib/"]');
    expect(result.files).toEqual(["src/**/*.ts", "lib/"]);
  });

  test("parses boolean values", () => {
    const result = parseFrontmatter("rules: true");
    expect(result.rules).toBe(true);
  });

  test("strips surrounding quotes from strings", () => {
    const result = parseFrontmatter('title: "My Title"');
    expect(result.title).toBe("My Title");
  });
});

describe("parseAdr", () => {
  test("parses a valid ADR file", async () => {
    const content = await Bun.file(join(FIXTURES, "sample-adr.md")).text();
    const doc = parseAdr(content, "sample-adr.md");
    expect(doc.frontmatter.id).toBe("GEN-001");
    expect(doc.frontmatter.title).toBe("Example Architecture Decision");
    expect(doc.frontmatter.domain).toBe("general");
    expect(doc.frontmatter.rules).toBe(false);
    expect(doc.body).toContain("# Example Architecture Decision");
  });

  test("throws for missing frontmatter", () => {
    expect(() => parseAdr("No frontmatter here", "bad.md")).toThrow(
      "No frontmatter found"
    );
  });

  test("throws for missing id", async () => {
    const content = await Bun.file(
      join(FIXTURES, "invalid-adr-missing-id.md")
    ).text();
    expect(() => parseAdr(content, "missing-id.md")).toThrow("id:");
  });

  test("throws for bad domain", async () => {
    const content = await Bun.file(
      join(FIXTURES, "invalid-adr-bad-domain.md")
    ).text();
    expect(() => parseAdr(content, "bad-domain.md")).toThrow("domain:");
  });
});
