// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import { parseAdr } from "../../src/formats/adr";
import {
  generateExampleAdr,
  generateAdrTemplate,
} from "../../src/helpers/adr-templates";

describe("generateExampleAdr", () => {
  test("produces a parseable ADR", () => {
    const content = generateExampleAdr("my-project");
    const doc = parseAdr(content, "GEN-001-example.md");
    expect(doc.frontmatter.id).toBe("GEN-001");
    expect(doc.frontmatter.domain).toBe("general");
    expect(doc.frontmatter.rules).toBe(false);
  });

  test("includes the project name in the body", () => {
    const content = generateExampleAdr("acme-corp");
    expect(content).toContain("acme-corp");
  });

  test("includes standard ADR sections", () => {
    const content = generateExampleAdr("test");
    expect(content).toContain("## Context");
    expect(content).toContain("## Decision");
    expect(content).toContain("## Consequences");
  });
});

describe("generateAdrTemplate", () => {
  test("produces a parseable ADR with required fields", () => {
    const content = generateAdrTemplate({
      id: "BE-001",
      title: "Use PostgreSQL",
      domain: "backend",
    });
    const doc = parseAdr(content, "BE-001-use-postgresql.md");
    expect(doc.frontmatter.id).toBe("BE-001");
    expect(doc.frontmatter.title).toBe("Use PostgreSQL");
    expect(doc.frontmatter.domain).toBe("backend");
    expect(doc.frontmatter.rules).toBe(false);
  });

  test("includes file patterns when provided", () => {
    const content = generateAdrTemplate({
      id: "FE-001",
      title: "Use React",
      domain: "frontend",
      files: ["src/ui/**/*.tsx"],
    });
    const doc = parseAdr(content, "FE-001-use-react.md");
    expect(doc.frontmatter.files).toEqual(["src/ui/**/*.tsx"]);
  });

  test("omits files field when not provided", () => {
    const content = generateAdrTemplate({
      id: "GEN-002",
      title: "Code Review",
      domain: "general",
    });
    const doc = parseAdr(content, "GEN-002-code-review.md");
    expect(doc.frontmatter.files).toBeUndefined();
  });

  test("includes placeholder sections", () => {
    const content = generateAdrTemplate({
      id: "ARCH-001",
      title: "Monorepo",
      domain: "architecture",
    });
    expect(content).toContain("## Context");
    expect(content).toContain("## Decision");
    expect(content).toContain("## Do's and Don'ts");
    expect(content).toContain("## Consequences");
    expect(content).toContain("## Compliance and Enforcement");
  });
});
