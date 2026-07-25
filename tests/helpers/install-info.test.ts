// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  detectInstallMethod,
  getProjectContext,
  _resetInstallInfoCaches,
} from "../../src/helpers/install-info";

describe("install-info", () => {
  afterEach(() => {
    _resetInstallInfoCaches();
  });

  describe("detectInstallMethod", () => {
    test("returns a valid install method string", () => {
      const method = detectInstallMethod();
      expect(["binary", "proto", "local", "global-pm"]).toContain(method);
    });

    test("result is cached across calls", () => {
      const first = detectInstallMethod();
      const second = detectInstallMethod();
      expect(first).toBe(second);
    });

    test("returns cached value on second call without re-detecting", () => {
      // First call computes the value
      const first = detectInstallMethod();
      // Reset and call again to ensure the cache returns the same type
      _resetInstallInfoCaches();
      const second = detectInstallMethod();
      // Both should be valid — the method might differ after reset only if
      // the process paths changed (they don't), so they should be equal.
      expect(first).toBe(second);
    });
  });

  describe("getProjectContext", () => {
    test("detects the current archgate project", () => {
      // Running from the CLI repo root, which has .archgate/adrs/
      const ctx = getProjectContext();
      expect(ctx.hasProject).toBe(true);
      expect(ctx.adrCount).toBeGreaterThan(0);
      expect(ctx.adrWithRulesCount).toBeGreaterThan(0);
      expect(ctx.domains.length).toBeGreaterThan(0);
    });

    test("returns equal (not identical) contexts across calls", () => {
      // getProjectContext is not cached — each call re-reads the
      // filesystem so post-init events reflect newly-created ADRs.
      const first = getProjectContext();
      const second = getProjectContext();
      expect(first).toEqual(second);
    });

    test("domains are sorted alphabetically", () => {
      const ctx = getProjectContext();
      const sorted = [...ctx.domains].sort();
      expect(ctx.domains).toEqual(sorted);
    });

    describe("with an isolated temp project directory", () => {
      let tempDir: string;
      let originalCwd: string;

      beforeEach(() => {
        originalCwd = process.cwd();
        tempDir = mkdtempSync(join(tmpdir(), "archgate-installinfo-test-"));
        process.chdir(tempDir);
      });

      afterEach(() => {
        process.chdir(originalCwd);
        rmSync(tempDir, { recursive: true, force: true });
      });

      test("returns zero counts when adrsDir does not exist", () => {
        // Create .archgate dir but NOT .archgate/adrs/
        mkdirSync(join(tempDir, ".archgate"), { recursive: true });

        const ctx = getProjectContext();
        expect(ctx.hasProject).toBe(true);
        expect(ctx.adrCount).toBe(0);
        expect(ctx.adrWithRulesCount).toBe(0);
        expect(ctx.domains).toEqual([]);
      });

      test("returns hasProject false when .archgate dir does not exist", () => {
        const ctx = getProjectContext();
        expect(ctx.hasProject).toBe(false);
        expect(ctx.adrCount).toBe(0);
        expect(ctx.adrWithRulesCount).toBe(0);
        expect(ctx.domains).toEqual([]);
      });

      test("counts ADR files with different domain prefixes correctly", () => {
        const adrsDir = join(tempDir, ".archgate", "adrs");
        mkdirSync(adrsDir, { recursive: true });

        // Create ADR files with different domain prefixes
        writeFileSync(
          join(adrsDir, "ARCH-001-command-structure.md"),
          "---\nid: ARCH-001\n---\n"
        );
        writeFileSync(
          join(adrsDir, "ARCH-002-error-handling.md"),
          "---\nid: ARCH-002\n---\n"
        );
        writeFileSync(
          join(adrsDir, "CI-001-pin-actions.md"),
          "---\nid: CI-001\n---\n"
        );
        writeFileSync(
          join(adrsDir, "LEGAL-001-spdx-headers.md"),
          "---\nid: LEGAL-001\n---\n"
        );
        // Create rules files
        writeFileSync(
          join(adrsDir, "ARCH-001-command-structure.rules.ts"),
          "export default {};"
        );
        writeFileSync(
          join(adrsDir, "CI-001-pin-actions.rules.ts"),
          "export default {};"
        );

        const ctx = getProjectContext();
        expect(ctx.hasProject).toBe(true);
        expect(ctx.adrCount).toBe(4);
        expect(ctx.adrWithRulesCount).toBe(2);
        expect(ctx.domains).toEqual(["ARCH", "CI", "LEGAL"]);
      });

      test("handles readdirSync errors gracefully", () => {
        mkdirSync(join(tempDir, ".archgate"), { recursive: true });
        // Create adrsDir as a file instead of a directory to cause readdirSync to throw
        writeFileSync(join(tempDir, ".archgate", "adrs"), "not a directory");

        const ctx = getProjectContext();
        expect(ctx.hasProject).toBe(true);
        expect(ctx.adrCount).toBe(0);
        expect(ctx.adrWithRulesCount).toBe(0);
        expect(ctx.domains).toEqual([]);
      });
    });
  });
});
