// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RuleResult } from "../../src/engine/runner";
import { applySuppressions } from "../../src/engine/suppressions";
import type { ViolationDetail } from "../../src/formats/rules";

// Sibling of suppressions.test.ts, which sits at oxlint's 500-line max-lines
// cap. Covers the suppression scan's file-read failure paths.
describe("applySuppressions I/O failures", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = realpathSync(
      mkdtempSync(join(tmpdir(), "archgate-suppress-io-"))
    );
    mkdirSync(join(tempDir, "src"), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* temp dir cleanup may fail on Windows */
    }
  });

  function makeViolation(
    overrides: Partial<ViolationDetail> = {}
  ): ViolationDetail {
    return {
      ruleId: "no-console",
      adrId: "ARCH-002",
      message: "Found console.log",
      file: "src/foo.ts",
      line: 2,
      severity: "error",
      ...overrides,
    };
  }

  function makeRuleResult(violations: ViolationDetail[]): RuleResult {
    return {
      ruleId: violations[0]?.ruleId ?? "test-rule",
      adrId: violations[0]?.adrId ?? "TEST-001",
      description: "Test rule",
      violations,
      durationMs: 10,
    };
  }

  test("a violation whose file is absent stays active", async () => {
    const v = makeViolation({ file: "src/never-written.ts", line: 1 });
    const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

    expect(result.suppressedCount).toBe(0);
    expect(result.activeViolations.has(v)).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  test("a file that exists but cannot be read yields no suppressions", async () => {
    // Absence is handled before the read, so this covers the other half: a
    // present file whose read fails must not abort the scan. Only a non-root
    // POSIX process can be denied, but the violation stays active either way.
    const denied = process.platform !== "win32" && process.getuid?.() !== 0;
    const file = join(tempDir, "src", "locked.ts");
    writeFileSync(file, 'console.log("hello");\n');
    if (denied) chmodSync(file, 0o000);

    try {
      const v = makeViolation({ file: "src/locked.ts", line: 1 });
      const result = await applySuppressions(tempDir, [makeRuleResult([v])]);

      expect(result.suppressedCount).toBe(0);
      expect(result.activeViolations.has(v)).toBe(true);
      expect(result.warnings).toHaveLength(0);
    } finally {
      // Restore before afterEach's rmSync so cleanup cannot fail.
      if (denied) chmodSync(file, 0o644);
    }
  });
});
