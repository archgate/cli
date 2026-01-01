import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findProjectRoot } from "../../src/helpers/paths";

describe("findProjectRoot", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-paths-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("finds root when .archgate/adrs/ exists", () => {
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });

    const result = findProjectRoot(tempDir);
    expect(result).toBe(tempDir);
  });

  test("finds root from a subdirectory", () => {
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    const subDir = join(tempDir, "src", "commands");
    mkdirSync(subDir, { recursive: true });

    const result = findProjectRoot(subDir);
    expect(result).toBe(tempDir);
  });

  test("returns null when no .archgate/adrs/ found", () => {
    const result = findProjectRoot(tempDir);
    expect(result).toBeNull();
  });
});
