import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectPaths } from "../../src/helpers/paths";
import { generateExampleAdr } from "../../src/helpers/adr-templates";
import { createPathIfNotExists } from "../../src/helpers/paths";
import { parseAdr } from "../../src/formats/adr";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "archgate-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("init governance skeleton", () => {
  test("creates .archgate directory structure", async () => {
    const paths = projectPaths(tempDir);

    createPathIfNotExists(paths.adrsDir);
    createPathIfNotExists(paths.lintDir);

    const exampleAdr = generateExampleAdr("test-project");
    await Bun.write(`${paths.adrsDir}/GEN-001-example.md`, exampleAdr);

    // Verify structure
    expect(existsSync(paths.root)).toBe(true);
    expect(existsSync(paths.adrsDir)).toBe(true);
    expect(existsSync(paths.lintDir)).toBe(true);
    expect(existsSync(`${paths.adrsDir}/GEN-001-example.md`)).toBe(true);
  });

  test("example ADR is valid", () => {
    const content = generateExampleAdr("test-project");
    const doc = parseAdr(content, "GEN-001-example.md");
    expect(doc.frontmatter.id).toBe("GEN-001");
    expect(doc.frontmatter.domain).toBe("general");
    expect(doc.body).toContain("test-project");
  });
});
