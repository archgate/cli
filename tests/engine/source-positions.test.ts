import { describe, expect, test } from "bun:test";

import { remapViolations, type RawViolation } from "../../src/engine/source-positions";

/**
 * Tests for the source position remapping module.
 *
 * The core logic (non-code range detection, code-only occurrence search,
 * position remapping through transpilation) is exercised extensively by
 * the scanner position and adversarial test suites. These tests verify
 * the public API contract directly.
 */
describe("remapViolations", () => {
  test("maps a single violation to correct position", () => {
    const original = "const x = 1;\nBun.spawn([]);";
    const raw: RawViolation[] = [
      { message: "blocked", searchText: "Bun.spawn", occurrence: 0 },
    ];
    const result = remapViolations(original, raw);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(2);
    expect(result[0].column).toBe(0);
    expect(result[0].endColumn).toBe(9);
  });

  test("skips occurrences in comments", () => {
    const original = "// Bun.spawn\nBun.spawn([]);";
    const raw: RawViolation[] = [
      { message: "blocked", searchText: "Bun.spawn", occurrence: 0 },
    ];
    const result = remapViolations(original, raw);
    expect(result[0].line).toBe(2);
  });

  test("skips occurrences in string literals", () => {
    const original = 'const x = "Bun.spawn";\nBun.spawn([]);';
    const raw: RawViolation[] = [
      { message: "blocked", searchText: "Bun.spawn", occurrence: 0 },
    ];
    const result = remapViolations(original, raw);
    expect(result[0].line).toBe(2);
  });

  test("handles multiple occurrences with correct ordering", () => {
    const original = "Bun.spawn([]);\nBun.spawn([]);";
    const raw: RawViolation[] = [
      { message: "first", searchText: "Bun.spawn", occurrence: 0 },
      { message: "second", searchText: "Bun.spawn", occurrence: 1 },
    ];
    const result = remapViolations(original, raw);
    expect(result[0].line).toBe(1);
    expect(result[1].line).toBe(2);
  });

  test("returns line 0 when search text not found in code", () => {
    const original = "const x = 1;";
    const raw: RawViolation[] = [
      { message: "missing", searchText: "Bun.spawn", occurrence: 0 },
    ];
    const result = remapViolations(original, raw);
    expect(result[0].line).toBe(0);
  });
});
