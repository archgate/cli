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

/** A `Bun.main` value Bun reports only inside a compiled standalone binary. */
const BUNFS_MAIN = "/$bunfs/root/archgate";

/** Assign `Bun.main`, which the published types declare as a constant. */
function setBunMain(main: string): void {
  Reflect.set(Bun, "main", main);
}

/** Present the process as a compiled binary living at `binary`. */
function asCompiledBinary(binary: string, main = BUNFS_MAIN): void {
  process.execPath = binary;
  setBunMain(main);
}

/** Present the process as the bun runtime at `bun` executing `script`. */
function asBunRuntime(bun: string, script: string): void {
  process.execPath = bun;
  setBunMain(script);
}

describe("install-info", () => {
  afterEach(() => {
    _resetInstallInfoCaches();
  });

  describe("executable resolution", () => {
    // Both helpers key off `Bun.main` naming a path under Bun's virtual
    // filesystem, so stubbing it simulates a compiled binary without
    // building one. `asCompiledBinary` and `asBunRuntime` set up each mode.
    let originalExecPath: string;
    let originalMain: string;

    beforeEach(() => {
      originalExecPath = process.execPath;
      originalMain = Bun.main;
    });

    afterEach(() => {
      process.execPath = originalExecPath;
      setBunMain(originalMain);
    });

    test.each([
      { label: "Linux and macOS", main: "/$bunfs/root/archgate" },
      { label: "Windows", main: "B:/~BUN/root/archgate" },
      {
        label: "Windows with backslashes",
        main: String.raw`B:\~BUN\root\archgate`,
      },
    ])(
      "archgatePath is the executable itself for a $label binary",
      ({ main }) => {
        const binary = join("/opt", "archgate", "archgate");
        asCompiledBinary(binary, main);
        expect(archgatePath()).toBe(binary);
      }
    );

    test("archgatePath is the entry script under the bun runtime", () => {
      const script = join("/repo", "src", "cli.ts");
      asBunRuntime(join("/usr", "local", "bin", "bun"), script);
      expect(archgatePath()).toBe(script);
    });

    test('a binary whose path contains "bun" still resolves to itself', () => {
      // The executable's own name and location carry no signal.
      const binary = join("/home", "bunny", "tools", "bun-archgate");
      asCompiledBinary(binary, "/$bunfs/root/archgate");
      expect(archgatePath()).toBe(binary);
    });

    test("a renamed runtime still resolves to the entry script", () => {
      const script = join("/repo", "src", "cli.ts");
      asBunRuntime(join("/opt", "runtimes", "js-engine"), script);
      expect(archgatePath()).toBe(script);
    });

    test("selfInvokeArgv spawns the binary directly when compiled", () => {
      const binary = join("/home", "u", ".archgate", "bin", "archgate");
      asCompiledBinary(binary, "/$bunfs/root/archgate");
      expect(selfInvokeArgv(["adr", "import", "--yes"])).toEqual([
        binary,
        "adr",
        "import",
        "--yes",
      ]);
    });

    test("selfInvokeArgv passes the entry script under the bun runtime", () => {
      const bun = join("/usr", "local", "bin", "bun");
      const script = join("/repo", "src", "cli.ts");
      asBunRuntime(bun, script);
      expect(selfInvokeArgv(["adr", "import"])).toEqual([
        bun,
        script,
        "adr",
        "import",
      ]);
    });

    test('selfInvokeArgv never yields the bare string "bun" as the command', () => {
      // A compiled binary must name its own executable, which stays
      // spawnable on machines where bun is absent from $PATH.
      asCompiledBinary(
        join("/home", "u", ".archgate", "bin", "archgate"),
        "/$bunfs/root/archgate"
      );
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
      // Compiled-binary mode classifies `process.execPath`, so pointing it at
      // a fabricated location exercises each branch without installing
      // anything.
      let tempHome: string;
      let originalExecPath: string;
      let originalMain: string;
      let originalHome: string | undefined;
      let originalProtoHome: string | undefined;

      beforeEach(() => {
        tempHome = mkdtempSync(join(tmpdir(), "archgate-installmethod-"));
        originalExecPath = process.execPath;
        originalMain = Bun.main;
        originalHome = Bun.env.HOME;
        originalProtoHome = Bun.env.PROTO_HOME;
        Bun.env.HOME = tempHome;
        delete Bun.env.PROTO_HOME;
        setBunMain(BUNFS_MAIN);
        _resetInstallInfoCaches();
      });

      afterEach(() => {
        process.execPath = originalExecPath;
        setBunMain(originalMain);
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
