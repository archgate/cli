import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseAdr } from "../../src/formats/adr";
import {
  slugify,
  getNextId,
  buildAdrContent,
  createAdrFile,
  findAdrFileById,
  updateAdrFile,
} from "../../src/helpers/adr-writer";

describe("slugify", () => {
  test("converts title to lowercase kebab-case", () => {
    expect(slugify("Use PostgreSQL")).toBe("use-postgresql");
  });

  test("replaces multiple non-alphanumeric chars with single dash", () => {
    expect(slugify("Hello   World!!!")).toBe("hello-world");
  });

  test("strips leading and trailing dashes", () => {
    expect(slugify("--trimmed--")).toBe("trimmed");
  });

  test("handles single word", () => {
    expect(slugify("Monorepo")).toBe("monorepo");
  });
});

describe("getNextId", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-writer-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns 001 when directory does not exist", () => {
    const id = getNextId(join(tempDir, "nonexistent"), "BE");
    expect(id).toBe("BE-001");
  });

  test("returns 001 when directory is empty", () => {
    mkdirSync(tempDir, { recursive: true });
    const id = getNextId(tempDir, "FE");
    expect(id).toBe("FE-001");
  });

  test("increments from the highest existing number", () => {
    writeFileSync(join(tempDir, "GEN-001-example.md"), "");
    writeFileSync(join(tempDir, "GEN-003-third.md"), "");
    const id = getNextId(tempDir, "GEN");
    expect(id).toBe("GEN-004");
  });

  test("ignores files with different prefixes", () => {
    writeFileSync(join(tempDir, "BE-005-backend.md"), "");
    const id = getNextId(tempDir, "FE");
    expect(id).toBe("FE-001");
  });
});

describe("buildAdrContent", () => {
  test("uses template when no body is provided", () => {
    const content = buildAdrContent({
      id: "GEN-001",
      title: "Test ADR",
      domain: "general",
    });
    const doc = parseAdr(content, "GEN-001-test-adr.md");
    expect(doc.frontmatter.id).toBe("GEN-001");
    expect(doc.body).toContain("## Context");
  });

  test("uses custom body when provided", () => {
    const content = buildAdrContent({
      id: "BE-001",
      title: "Custom",
      domain: "backend",
      body: "# Custom Body\n\nCustom content here.",
    });
    const doc = parseAdr(content, "BE-001-custom.md");
    expect(doc.frontmatter.id).toBe("BE-001");
    expect(doc.body).toContain("Custom content here.");
  });

  test("includes files in frontmatter when provided with body", () => {
    const content = buildAdrContent({
      id: "FE-001",
      title: "With Files",
      domain: "frontend",
      body: "# Body",
      files: ["src/**/*.tsx"],
    });
    const doc = parseAdr(content, "FE-001-with-files.md");
    expect(doc.frontmatter.files).toEqual(["src/**/*.tsx"]);
  });

  test("sets rules field when provided with body", () => {
    const content = buildAdrContent({
      id: "ARCH-001",
      title: "With Rules",
      domain: "architecture",
      body: "# Body",
      rules: true,
    });
    const doc = parseAdr(content, "ARCH-001-with-rules.md");
    expect(doc.frontmatter.rules).toBe(true);
  });
});

describe("createAdrFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-createadr-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates a file on disk and returns metadata", async () => {
    const result = await createAdrFile(tempDir, {
      title: "My Decision",
      domain: "general",
    });
    expect(result.id).toBe("GEN-001");
    expect(result.fileName).toBe("GEN-001-my-decision.md");
    expect(existsSync(result.filePath)).toBe(true);
  });

  test("generated file is a valid ADR", async () => {
    const result = await createAdrFile(tempDir, {
      title: "Valid ADR",
      domain: "backend",
    });
    const content = await Bun.file(result.filePath).text();
    const doc = parseAdr(content, result.fileName);
    expect(doc.frontmatter.id).toBe("BE-001");
    expect(doc.frontmatter.title).toBe("Valid ADR");
    expect(doc.frontmatter.domain).toBe("backend");
  });

  test("auto-increments ID based on existing files", async () => {
    writeFileSync(join(tempDir, "FE-001-first.md"), "");
    const result = await createAdrFile(tempDir, {
      title: "Second",
      domain: "frontend",
    });
    expect(result.id).toBe("FE-002");
  });
});

describe("findAdrFileById", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-find-adr-test-"));
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns null when directory does not exist", async () => {
    const result = await findAdrFileById(
      join(tempDir, "nonexistent"),
      "GEN-001"
    );
    expect(result).toBeNull();
  });

  test("returns null when ADR ID is not found", async () => {
    await createAdrFile(tempDir, {
      title: "Existing",
      domain: "general",
      body: "## Context\n\nSome context.",
    });
    const result = await findAdrFileById(tempDir, "GEN-999");
    expect(result).toBeNull();
  });

  test("returns the matching AdrDocument", async () => {
    await createAdrFile(tempDir, {
      title: "Found ADR",
      domain: "backend",
      body: "## Context\n\nBackend context.",
    });
    const result = await findAdrFileById(tempDir, "BE-001");
    expect(result).not.toBeNull();
    expect(result!.frontmatter.id).toBe("BE-001");
    expect(result!.frontmatter.title).toBe("Found ADR");
    expect(result!.body).toContain("Backend context.");
  });

  test("skips unparseable files gracefully", async () => {
    writeFileSync(join(tempDir, "BAD-001-broken.md"), "not valid frontmatter");
    await createAdrFile(tempDir, {
      title: "Good ADR",
      domain: "general",
      body: "## Context\n\nOk.",
    });
    const result = await findAdrFileById(tempDir, "GEN-001");
    expect(result).not.toBeNull();
    expect(result!.frontmatter.id).toBe("GEN-001");
  });
});

describe("updateAdrFile", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-update-adr-test-"));
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("throws when ADR ID is not found", () => {
    expect(
      updateAdrFile(tempDir, { id: "GEN-999", body: "## Context\n\nNew body." })
    ).rejects.toThrow("ADR GEN-999 not found");
  });

  test("updates body while preserving frontmatter fields", async () => {
    await createAdrFile(tempDir, {
      title: "Original Title",
      domain: "backend",
      body: "## Context\n\nOriginal body.",
      rules: true,
      files: ["src/backend/**"],
    });

    const result = await updateAdrFile(tempDir, {
      id: "BE-001",
      body: "## Context\n\nUpdated body with new content.",
    });

    expect(result.id).toBe("BE-001");
    const content = await Bun.file(result.filePath).text();
    const doc = parseAdr(content, result.fileName);
    expect(doc.frontmatter.title).toBe("Original Title");
    expect(doc.frontmatter.domain).toBe("backend");
    expect(doc.frontmatter.rules).toBe(true);
    expect(doc.frontmatter.files).toEqual(["src/backend/**"]);
    expect(doc.body).toContain("Updated body with new content.");
  });

  test("overrides frontmatter fields when provided", async () => {
    await createAdrFile(tempDir, {
      title: "Old Title",
      domain: "general",
      body: "## Context\n\nOld body.",
    });

    const result = await updateAdrFile(tempDir, {
      id: "GEN-001",
      title: "New Title",
      domain: "architecture",
      body: "## Context\n\nNew body.",
      rules: true,
      files: ["src/**"],
    });

    const content = await Bun.file(result.filePath).text();
    const doc = parseAdr(content, result.fileName);
    expect(doc.frontmatter.title).toBe("New Title");
    expect(doc.frontmatter.domain).toBe("architecture");
    expect(doc.frontmatter.rules).toBe(true);
    expect(doc.frontmatter.files).toEqual(["src/**"]);
    expect(doc.body).toContain("New body.");
  });

  test("writes to the same file path (filename unchanged)", async () => {
    const created = await createAdrFile(tempDir, {
      title: "Stable Filename",
      domain: "frontend",
      body: "## Context\n\nOriginal.",
    });

    const updated = await updateAdrFile(tempDir, {
      id: "FE-001",
      body: "## Context\n\nModified.",
    });

    expect(updated.filePath).toBe(created.filePath);
    expect(updated.fileName).toBe(created.fileName);
  });
});
