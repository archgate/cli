// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  archgatePath,
  detectInstallMethod,
  getProjectContext,
  selfInvokeArgv,
  _resetInstallInfoCaches,
} from "../../src/helpers/install-info";
import { restoreEnv } from "../test-utils";

describe("install-info", () => {
  afterEach(() => {
    _resetInstallInfoCaches();
  });

  describe("executable resolution", () => {
    // Both helpers key off `process.execPath` naming the bun runtime, so
    // swapping it simulates the compiled binary without building one.
    let originalExecPath: string;

    beforeEach(() => {
      originalExecPath = process.execPath;
    });

    afterEach(() => {
      process.execPath = originalExecPath;
    });

    test("archgatePath is the executable itself for a compiled binary", () => {
      process.execPath = join("/opt", "archgate", "archgate");
      expect(archgatePath()).toBe(join("/opt", "archgate", "archgate"));
    });

    test("archgatePath falls back to the entry script under the bun runtime", () => {
      process.execPath = join("/usr", "local", "bin", "bun");
      expect(archgatePath()).toBe(Bun.main);
    });

    test("selfInvokeArgv spawns the binary directly when compiled", () => {
      const binary = join("/home", "u", ".archgate", "bin", "archgate");
      process.execPath = binary;
      expect(selfInvokeArgv(["adr", "import", "--yes"])).toEqual([
        binary,
        "adr",
        "import",
        "--yes",
      ]);
    });

    test("selfInvokeArgv passes the entry script under the bun runtime", () => {
      const bun = join("/usr", "local", "bin", "bun");
      process.execPath = bun;
      expect(selfInvokeArgv(["adr", "import"])).toEqual([
        bun,
        Bun.main,
        "adr",
        "import",
      ]);
    });

    test('selfInvokeArgv never yields the bare string "bun" as the command', () => {
      // Regression: `process.argv[0]` is the literal "bun" inside a compiled
      // standalone binary, so spawning it failed with
      // `Executable not found in $PATH: "bun"`.
      process.execPath = join("/home", "u", ".archgate", "bin", "archgate");
      expect(selfInvokeArgv(["adr", "import"])[0]).not.toBe("bun");
    });
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

    describe("with a synthetic executable path", () => {
      // `process.execPath` is the only input to the classification when it
      // does not name the bun runtime, so pointing it at a fabricated
      // location exercises each branch without installing anything.
      let tempHome: string;
      let originalExecPath: string;
      let originalHome: string | undefined;
      let originalProtoHome: string | undefined;

      beforeEach(() => {
        tempHome = mkdtempSync(join(tmpdir(), "archgate-installmethod-"));
        originalExecPath = process.execPath;
        originalHome = Bun.env.HOME;
        originalProtoHome = Bun.env.PROTO_HOME;
        Bun.env.HOME = tempHome;
        delete Bun.env.PROTO_HOME;
        _resetInstallInfoCaches();
      });

      afterEach(() => {
        process.execPath = originalExecPath;
        restoreEnv("HOME", originalHome);
        restoreEnv("PROTO_HOME", originalProtoHome);
        _resetInstallInfoCaches();
        rmSync(tempHome, { recursive: true, force: true });
      });

      test.each([
        {
          label: "~/.archgate/bin",
          segments: [".archgate", "bin", "archgate"],
          method: "binary",
        },
        {
          label: "the ~/.proto fallback when PROTO_HOME is unset",
          segments: [".proto", "tools", "archgate", "1.2.3", "archgate"],
          method: "proto",
        },
        {
          label: "node_modules/.bin",
          segments: ["project", "node_modules", ".bin", "archgate"],
          method: "local",
        },
        {
          label: "an unrecognized prefix",
          segments: ["usr", "local", "archgate"],
          method: "global-pm",
        },
      ] as const)(
        "classifies an executable under $label as $method",
        ({ segments, method }) => {
          process.execPath = join(tempHome, ...segments);
          expect(detectInstallMethod()).toBe(method);
        }
      );

      test("an executable under PROTO_HOME/tools/archgate is a proto install", () => {
        const protoHome = join(tempHome, "custom-proto");
        Bun.env.PROTO_HOME = protoHome;
        process.execPath = join(
          protoHome,
          "tools",
          "archgate",
          "1.2.3",
          "archgate"
        );
        expect(detectInstallMethod()).toBe("proto");
      });

      test("the first classification is cached, later path changes ignored", () => {
        process.execPath = join(tempHome, ".archgate", "bin", "archgate");
        expect(detectInstallMethod()).toBe("binary");

        process.execPath = join(tempHome, "usr", "local", "archgate");
        expect(detectInstallMethod()).toBe("binary");
      });
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
