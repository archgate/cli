// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerUpgradeCommand } from "../../src/commands/upgrade";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Dynamic import with cache-busting for modules with process-level state. */
function importUpgrade() {
  return import(`../../src/commands/upgrade?t=${Date.now()}`);
}

function setExecPath(path: string) {
  Object.defineProperty(process, "execPath", {
    value: path,
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

describe("registerUpgradeCommand", () => {
  test("registers 'upgrade' with a description", () => {
    const program = new Command();
    registerUpgradeCommand(program);
    const sub = program.commands.find((c) => c.name() === "upgrade");
    expect(sub).toBeDefined();
    expect(sub!.description()).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Install method detection
// ---------------------------------------------------------------------------

describe("install method detection", () => {
  let tempDir: string;
  let originalExecPath: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalProtoHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-upgrade-test-"));
    originalExecPath = process.execPath;
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalProtoHome = process.env.PROTO_HOME;
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
    delete process.env.PROTO_HOME;
  });

  afterEach(() => {
    setExecPath(originalExecPath);
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (originalProtoHome === undefined) delete process.env.PROTO_HOME;
    else process.env.PROTO_HOME = originalProtoHome;
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("_isBinaryInstall", () => {
    test("returns true when execPath is under ~/.archgate/bin/", async () => {
      setExecPath(join(tempDir, ".archgate", "bin", "archgate"));
      const { _isBinaryInstall } = await importUpgrade();
      expect(_isBinaryInstall()).toBe(true);
    });

    test("returns false when execPath is elsewhere", async () => {
      setExecPath(join(tempDir, "usr", "local", "bin", "archgate"));
      const { _isBinaryInstall } = await importUpgrade();
      expect(_isBinaryInstall()).toBe(false);
    });
  });

  describe("_isProtoInstall", () => {
    test("returns true when execPath is under ~/.proto/tools/archgate/", async () => {
      setExecPath(
        join(tempDir, ".proto", "tools", "archgate", "0.13.0", "archgate")
      );
      const { _isProtoInstall } = await importUpgrade();
      expect(_isProtoInstall()).toBe(true);
    });

    test("respects PROTO_HOME env var", async () => {
      const customProto = join(tempDir, "custom-proto");
      process.env.PROTO_HOME = customProto;
      setExecPath(join(customProto, "tools", "archgate", "0.13.0", "archgate"));
      const { _isProtoInstall } = await importUpgrade();
      expect(_isProtoInstall()).toBe(true);
    });

    test("returns false when execPath is elsewhere", async () => {
      setExecPath(join(tempDir, "usr", "local", "bin", "archgate"));
      const { _isProtoInstall } = await importUpgrade();
      expect(_isProtoInstall()).toBe(false);
    });
  });

  describe("_isLocalInstall", () => {
    test("returns true when execPath contains node_modules", async () => {
      setExecPath(join(tempDir, "project", "node_modules", ".bin", "archgate"));
      const { _isLocalInstall } = await importUpgrade();
      expect(_isLocalInstall()).toBe(true);
    });

    test("returns false when execPath has no node_modules", async () => {
      setExecPath(join(tempDir, "usr", "local", "bin", "archgate"));
      const { _isLocalInstall } = await importUpgrade();
      expect(_isLocalInstall()).toBe(false);
    });
  });

  describe("_detectInstallMethod", () => {
    test("detects binary install", async () => {
      const fakeBinary = join(tempDir, ".archgate", "bin", "archgate");
      setExecPath(fakeBinary);
      const { _detectInstallMethod } = await importUpgrade();
      const method = await _detectInstallMethod();
      expect(method.type).toBe("binary");
      expect(method).toHaveProperty("binaryPath", fakeBinary);
    });

    test("detects proto install", async () => {
      setExecPath(
        join(tempDir, ".proto", "tools", "archgate", "0.13.0", "archgate")
      );
      const { _detectInstallMethod } = await importUpgrade();
      const method = await _detectInstallMethod();
      expect(method.type).toBe("proto");
      expect(method).toHaveProperty("protoCmd");
    });

    test("detects local install with bun.lock", async () => {
      const dir = join(tempDir, "project-bun");
      mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(dir, "package.json"), "{}");
      writeFileSync(join(dir, "bun.lock"), "");
      setExecPath(join(dir, "node_modules", ".bin", "archgate"));
      const { _detectInstallMethod } = await importUpgrade();
      const method = await _detectInstallMethod();
      expect(method.type).toBe("local");
      expect(method.manualHint).toContain("bun");
    });

    test("detects local install with pnpm-lock.yaml", async () => {
      const dir = join(tempDir, "project-pnpm");
      mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(dir, "package.json"), "{}");
      writeFileSync(join(dir, "pnpm-lock.yaml"), "");
      setExecPath(join(dir, "node_modules", ".bin", "archgate"));
      const { _detectInstallMethod } = await importUpgrade();
      const method = await _detectInstallMethod();
      expect(method.type).toBe("local");
      expect(method.manualHint).toContain("pnpm");
    });

    test("detects local install with yarn.lock", async () => {
      const dir = join(tempDir, "project-yarn");
      mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(dir, "package.json"), "{}");
      writeFileSync(join(dir, "yarn.lock"), "");
      setExecPath(join(dir, "node_modules", ".bin", "archgate"));
      const { _detectInstallMethod } = await importUpgrade();
      const method = await _detectInstallMethod();
      expect(method.type).toBe("local");
      expect(method.manualHint).toContain("yarn");
    });

    test("detects local install with package-lock.json", async () => {
      const dir = join(tempDir, "project-npm");
      mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(dir, "package.json"), "{}");
      writeFileSync(join(dir, "package-lock.json"), "{}");
      setExecPath(join(dir, "node_modules", ".bin", "archgate"));
      const { _detectInstallMethod } = await importUpgrade();
      const method = await _detectInstallMethod();
      expect(method.type).toBe("local");
      expect(method.manualHint).toContain("npm");
    });

    test("falls back to package-manager for unknown location", async () => {
      setExecPath(join(tempDir, "some", "random", "path", "archgate"));
      const { _detectInstallMethod } = await importUpgrade();
      const method = await _detectInstallMethod();
      expect(method.type).toBe("package-manager");
    });

    test("binary detection takes priority over other methods", async () => {
      setExecPath(join(tempDir, ".archgate", "bin", "archgate"));
      const { _detectInstallMethod } = await importUpgrade();
      const method = await _detectInstallMethod();
      expect(method.type).toBe("binary");
    });
  });
});

// ---------------------------------------------------------------------------
// Pure helpers: formatBytes, createDownloadProgress
// ---------------------------------------------------------------------------

describe("_formatBytes", () => {
  test("formats bytes, KB, and MB ranges", async () => {
    const { _formatBytes } = await importUpgrade();
    // Bytes
    expect(_formatBytes(0)).toBe("0 B");
    expect(_formatBytes(512)).toBe("512 B");
    expect(_formatBytes(1023)).toBe("1023 B");
    // KB
    expect(_formatBytes(1024)).toBe("1.0 KB");
    expect(_formatBytes(1536)).toBe("1.5 KB");
    expect(_formatBytes(1024 * 100)).toBe("100.0 KB");
    // MB
    expect(_formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(_formatBytes(1024 * 1024 * 5.5)).toBe("5.5 MB");
    expect(_formatBytes(1024 * 1024 * 100)).toBe("100.0 MB");
  });
});

describe("_createDownloadProgress", () => {
  test("returns undefined when stderr is not a TTY", async () => {
    const { _createDownloadProgress } = await importUpgrade();
    const originalIsTTY = process.stderr.isTTY;
    try {
      Object.defineProperty(process.stderr, "isTTY", {
        value: false,
        configurable: true,
      });
      expect(_createDownloadProgress()).toBeUndefined();
    } finally {
      Object.defineProperty(process.stderr, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Action handler — uses globalThis.fetch mock (ARCH-005) to intercept the
// network call made by fetchLatestGitHubVersion inside the action.
// ---------------------------------------------------------------------------

describe("upgrade action handler", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  function makeProgram(): Command {
    const program = new Command().exitOverride();
    registerUpgradeCommand(program);
    return program;
  }

  /** Mock fetch to return a GitHub release tag response. */
  function mockGitHubRelease(tag: string | null) {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: tag === null ? false : true,
        status: tag === null ? 500 : 200,
        json: () => Promise.resolve(tag ? { tag_name: tag } : {}),
      })) as unknown as typeof fetch;
  }

  test("prints already up-to-date when current version >= latest", async () => {
    // package.json version is 0.36.3; returning same version = up-to-date
    mockGitHubRelease("v0.36.3");
    const program = makeProgram();
    try {
      await program.parseAsync(["node", "test", "upgrade"]);
    } catch {
      // exitWith(0) → process.exit(0) → throws "process.exit"
    }
    const out = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(out).toContain("already up-to-date");
  });

  test("prints error and exits 1 when version fetch fails", async () => {
    mockGitHubRelease(null);
    const program = makeProgram();
    try {
      await program.parseAsync(["node", "test", "upgrade"]);
    } catch {
      // exitWith(1) → process.exit(1) → throws "process.exit"
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("treats older remote version as up-to-date", async () => {
    mockGitHubRelease("v0.1.0");
    const program = makeProgram();
    try {
      await program.parseAsync(["node", "test", "upgrade"]);
    } catch {
      // exitWith(0) → process.exit(0) → throws "process.exit"
    }
    expect(exitSpy).toHaveBeenCalledWith(0);
    const out = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(out).toContain("already up-to-date");
  });

  test("exits 1 when fetch throws a network error", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("network error"))) as unknown as typeof fetch;
    const program = makeProgram();
    try {
      await program.parseAsync(["node", "test", "upgrade"]);
    } catch {
      // exitWith(1) → process.exit(1) → throws
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
