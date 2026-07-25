// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { parseYamlDocument } from "../../src/engine/yaml-utils";

describe("parseYamlDocument — YAML files (.yml/.yaml)", () => {
  test("parses the whole document with frontmatter null", () => {
    const result = parseYamlDocument(
      "name: archgate\ntags:\n  - cli\n",
      "conf/x.yml"
    );
    expect(result.frontmatter).toBeNull();
    expect(result.content).toEqual({ name: "archgate", tags: ["cli"] });
  });

  test("extension match is case-insensitive and covers .yaml", () => {
    expect(parseYamlDocument("a: 1\n", "X.YAML").content).toEqual({ a: 1 });
  });

  test("a leading --- document marker is NOT treated as frontmatter", () => {
    const result = parseYamlDocument(
      "---\nkind: Deployment\n---\nkind: Service\n",
      "k8s.yml"
    );
    expect(result.frontmatter).toBeNull();
    // Multi-document stream parses as one YAML value, never as frontmatter.
    expect(result.content).toEqual([
      { kind: "Deployment" },
      { kind: "Service" },
    ]);
  });

  test("strips a leading UTF-8 BOM", () => {
    expect(parseYamlDocument("﻿key: value\n", "x.yml").content).toEqual({
      key: "value",
    });
  });

  test("throws on invalid YAML with the file path in the message", () => {
    expect(() => parseYamlDocument("key: [unclosed", "conf/bad.yml")).toThrow(
      /Failed to parse "conf\/bad\.yml" as YAML/u
    );
  });
});

describe("parseYamlDocument — frontmatter files (everything else)", () => {
  test("parses the leading block and returns the body as content", () => {
    const md = "---\ntitle: Hello\ndraft: false\n---\n\n# Body\n";
    const result = parseYamlDocument(md, "doc.md");
    expect(result.frontmatter).toEqual({ title: "Hello", draft: false });
    expect(result.content).toBe("# Body");
  });

  test("handles CRLF line endings and a leading BOM", () => {
    const md = "﻿---\r\ntitle: Hello\r\n---\r\nBody\r\n";
    const result = parseYamlDocument(md, "doc.md");
    expect(result.frontmatter).toEqual({ title: "Hello" });
    expect(result.content).toBe("Body");
  });

  test("no frontmatter: null frontmatter, whole text as content", () => {
    const result = parseYamlDocument("# Just a heading\n", "doc.md");
    expect(result.frontmatter).toBeNull();
    expect(result.content).toBe("# Just a heading");
  });

  test("a delimiter that is not at the very start is not frontmatter", () => {
    const result = parseYamlDocument("\n---\ntitle: x\n---\n", "doc.md");
    expect(result.frontmatter).toBeNull();
  });

  test("rejects a malformed closing fence instead of parsing a partial block", () => {
    // `----` / `---note` must NOT terminate the block — a bare `\n---` match
    // would parse a truncated block and leave the stray chars in the body.
    for (const fence of ["----", "---note", "--- note"]) {
      const result = parseYamlDocument(
        `---\ntitle: x\n${fence}\nBody\n`,
        "doc.md"
      );
      expect(
        result.frontmatter,
        `fence "${fence}" must not terminate`
      ).toBeNull();
    }
  });

  test("tolerates trailing spaces/tabs on either fence", () => {
    const result = parseYamlDocument("--- \ntitle: x\n---\t\nBody\n", "doc.md");
    expect(result.frontmatter).toEqual({ title: "x" });
    expect(result.content).toBe("Body");
  });

  test("accepts a closing fence at end of input with no trailing newline", () => {
    const result = parseYamlDocument("---\ntitle: x\n---", "doc.md");
    expect(result.frontmatter).toEqual({ title: "x" });
    expect(result.content).toBe("");
  });

  test("returns {} for an empty frontmatter block", () => {
    const result = parseYamlDocument("---\n\n---\nBody\n", "doc.md");
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe("Body");
  });

  test("returns {} for a FULLY empty block with no line between fences", () => {
    // `---\n---` is the degenerate empty block. Distinct from the case above,
    // which has a blank line the body group can capture — testing only that
    // variant hides a required-newline-before-the-closing-fence bug.
    const result = parseYamlDocument("---\n---\nBody\n", "doc.md");
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe("Body");
  });

  test("returns {} for a fully empty block at end of input", () => {
    const result = parseYamlDocument("---\n---", "doc.md");
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe("");
  });

  test("returns {} for a fully empty block with CRLF endings", () => {
    const result = parseYamlDocument("---\r\n---\r\nBody\r\n", "doc.md");
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe("Body");
  });

  test("body content is never parsed as YAML (no spurious throw)", () => {
    const md = "---\ntitle: x\n---\nkey: [unclosed looks like bad YAML\n";
    expect(parseYamlDocument(md, "doc.md").content).toBe(
      "key: [unclosed looks like bad YAML"
    );
  });

  test("throws on an invalid YAML frontmatter block", () => {
    expect(() =>
      parseYamlDocument("---\nkey: [unclosed\n---\n", "doc.md")
    ).toThrow(/Failed to parse frontmatter of "doc\.md" as YAML/u);
  });

  test("throws when the block is not a mapping", () => {
    expect(() => parseYamlDocument("---\n- a\n- b\n---\n", "doc.md")).toThrow(
      /not a YAML mapping — got a sequence/u
    );
    expect(() => parseYamlDocument("---\n42\n---\n", "doc.md")).toThrow(
      /not a YAML mapping — got a number/u
    );
  });
});
