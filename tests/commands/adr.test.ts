import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseAdr } from "../../src/formats/adr";
import {
  generateExampleAdr,
  generateAdrTemplate,
} from "../../src/helpers/adr-templates";
import { createAdrFile, updateAdrFile } from "../../src/helpers/adr-writer";
import { projectPaths, createPathIfNotExists } from "../../src/helpers/paths";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "archgate-adr-test-"));
  const paths = projectPaths(tempDir);
  createPathIfNotExists(paths.adrsDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("adr list", () => {
  test("lists ADRs from adrs directory", async () => {
    const paths = projectPaths(tempDir);
    const exampleAdr = generateExampleAdr("test-project");
    await Bun.write(`${paths.adrsDir}/GEN-001-example.md`, exampleAdr);

    const files = readdirSync(paths.adrsDir).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(1);

    const content = await Bun.file(`${paths.adrsDir}/${files[0]}`).text();
    const doc = parseAdr(content, files[0]);
    expect(doc.frontmatter.id).toBe("GEN-001");
    expect(doc.frontmatter.domain).toBe("general");
  });

  test("handles empty adrs directory", () => {
    const paths = projectPaths(tempDir);
    const files = readdirSync(paths.adrsDir).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(0);
  });
});

describe("adr show", () => {
  test("finds ADR by ID", async () => {
    const paths = projectPaths(tempDir);
    const exampleAdr = generateExampleAdr("test-project");
    await Bun.write(`${paths.adrsDir}/GEN-001-example.md`, exampleAdr);

    const files = readdirSync(paths.adrsDir).filter((f) => f.endsWith(".md"));
    const entries = await Promise.all(
      files.map(async (file) => {
        const content = await Bun.file(`${paths.adrsDir}/${file}`).text();
        return parseAdr(content, file);
      })
    );
    const found = entries.find((doc) => doc.frontmatter.id === "GEN-001");
    expect(found).toBeDefined();
    expect(found!.frontmatter.title).toBe("Example Architecture Decision");
  });
});

describe("adr create", () => {
  test("generateAdrTemplate creates valid ADR content", () => {
    const content = generateAdrTemplate({
      id: "BE-001",
      title: "Use PostgreSQL",
      domain: "backend",
      files: ["src/db/**/*.ts"],
    });

    const doc = parseAdr(content, "BE-001-use-postgresql.md");
    expect(doc.frontmatter.id).toBe("BE-001");
    expect(doc.frontmatter.title).toBe("Use PostgreSQL");
    expect(doc.frontmatter.domain).toBe("backend");
    expect(doc.frontmatter.files).toEqual(["src/db/**/*.ts"]);
  });

  test("generateAdrTemplate works without files", () => {
    const content = generateAdrTemplate({
      id: "GEN-002",
      title: "Code Review Policy",
      domain: "general",
    });

    const doc = parseAdr(content, "GEN-002-code-review-policy.md");
    expect(doc.frontmatter.id).toBe("GEN-002");
    expect(doc.frontmatter.files).toBeUndefined();
  });
});

describe("adr update", () => {
  test("updates body while preserving frontmatter", async () => {
    const paths = projectPaths(tempDir);
    const created = await createAdrFile(paths.adrsDir, {
      title: "Original Title",
      domain: "general",
      body: "## Context\nOriginal body.",
    });

    const result = await updateAdrFile(paths.adrsDir, {
      id: created.id,
      body: "## Context\nUpdated body.",
    });

    expect(result.id).toBe(created.id);
    expect(result.filePath).toBe(created.filePath);

    const content = await Bun.file(result.filePath).text();
    const doc = parseAdr(content, result.fileName);
    expect(doc.frontmatter.title).toBe("Original Title");
    expect(doc.frontmatter.domain).toBe("general");
    expect(doc.body).toContain("Updated body.");
    expect(doc.body).not.toContain("Original body.");
  });

  test("overrides frontmatter fields when provided", async () => {
    const paths = projectPaths(tempDir);
    const created = await createAdrFile(paths.adrsDir, {
      title: "Original Title",
      domain: "general",
      body: "## Context\nBody content.",
      files: ["src/**/*.ts"],
    });

    const result = await updateAdrFile(paths.adrsDir, {
      id: created.id,
      body: "## Context\nNew body.",
      title: "New Title",
      domain: "backend",
      files: ["src/api/**/*.ts"],
      rules: true,
    });

    const content = await Bun.file(result.filePath).text();
    const doc = parseAdr(content, result.fileName);
    expect(doc.frontmatter.title).toBe("New Title");
    expect(doc.frontmatter.domain).toBe("backend");
    expect(doc.frontmatter.files).toEqual(["src/api/**/*.ts"]);
    expect(doc.frontmatter.rules).toBe(true);
  });

  test("errors when ADR ID not found", async () => {
    const paths = projectPaths(tempDir);
    await expect(
      updateAdrFile(paths.adrsDir, {
        id: "NONEXISTENT-999",
        body: "## Context\nBody.",
      })
    ).rejects.toThrow("ADR NONEXISTENT-999 not found");
  });

  test("errors when adrs directory does not exist", async () => {
    const nonexistentDir = join(tempDir, "nonexistent", "adrs");
    await expect(
      updateAdrFile(nonexistentDir, {
        id: "GEN-001",
        body: "## Context\nBody.",
      })
    ).rejects.toThrow("ADR GEN-001 not found");
  });

  test("filename stays immutable after update", async () => {
    const paths = projectPaths(tempDir);
    const created = await createAdrFile(paths.adrsDir, {
      title: "Original Title",
      domain: "general",
      body: "## Context\nOriginal.",
    });

    const result = await updateAdrFile(paths.adrsDir, {
      id: created.id,
      body: "## Context\nUpdated.",
      title: "Completely Different Title",
    });

    // Filename should not change even when title changes
    expect(result.fileName).toBe(created.fileName);
    expect(result.filePath).toBe(created.filePath);
    expect(existsSync(result.filePath)).toBe(true);

    // Only one file should exist (same path)
    const files = readdirSync(paths.adrsDir).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(1);
  });
});
