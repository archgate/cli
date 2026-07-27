// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import {
  registerUpgradeCommand,
  _isBinaryInstall,
  _isProtoInstall,
  _isLocalInstall,
  _detectInstallMethod,
  _formatBytes,
  _createDownloadProgress,
} from "../../src/commands/upgrade";
import { restoreEnv } from "../test-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    restoreEnv("HOME", originalHome);
    restoreEnv("USERPROFILE", originalUserProfile);
    restoreEnv("PROTO_HOME", originalProtoHome);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("_isBinaryInstall", () => {
    test("returns true when execPath is under ~/.archgate/bin/", () => {
      setExecPath(join(tempDir, ".archgate", "bin", "archgate"));
      expect(_isBinaryInstall()).toBe(true);
    });

    test("returns false when execPath is elsewhere", () => {
      setExecPath(join(tempDir, "usr", "local", "bin", "archgate"));
      expect(_isBinaryInstall()).toBe(false);
    });
  });

  describe("_isProtoInstall", () => {
    test("returns true when execPath is under ~/.proto/tools/archgate/", () => {
      setExecPath(
        join(tempDir, ".proto", "tools", "archgate", "0.13.0", "archgate")
      );
      expect(_isProtoInstall()).toBe(true);
    });

    test("respects PROTO_HOME env var", () => {
      const customProto = join(tempDir, "custom-proto");
      process.env.PROTO_HOME = customProto;
      setExecPath(join(customProto, "tools", "archgate", "0.13.0", "archgate"));
      expect(_isProtoInstall()).toBe(true);
    });

    test("returns false when execPath is elsewhere", () => {
      setExecPath(join(tempDir, "usr", "local", "bin", "archgate"));
      expect(_isProtoInstall()).toBe(false);
    });
  });

  describe("_isLocalInstall", () => {
    test("returns true when execPath contains node_modules", () => {
      setExecPath(join(tempDir, "project", "node_modules", ".bin", "archgate"));
      expect(_isLocalInstall()).toBe(true);
    });

    test("returns false when execPath has no node_modules", () => {
      setExecPath(join(tempDir, "usr", "local", "bin", "archgate"));
      expect(_isLocalInstall()).toBe(false);
    });
  });

  describe("_detectInstallMethod", () => {
    test("detects binary install", async () => {
      const fakeBinary = join(tempDir, ".archgate", "bin", "archgate");
      setExecPath(fakeBinary);
      const method = await _detectInstallMethod();
      expect(method.type).toBe("binary");
      expect(method).toHaveProperty("binaryPath", fakeBinary);
    });

    test("detects proto install", async () => {
      setExecPath(
        join(tempDir, ".proto", "tools", "archgate", "0.13.0", "archgate")
      );
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
      const method = await _detectInstallMethod();
      expect(method.type).toBe("local");
      if (method.type === "local") expect(method.manualHint).toContain("bun");
    });

    test("detects local install with pnpm-lock.yaml", async () => {
      const dir = join(tempDir, "project-pnpm");
      mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(dir, "package.json"), "{}");
      writeFileSync(join(dir, "pnpm-lock.yaml"), "");
      setExecPath(join(dir, "node_modules", ".bin", "archgate"));
      const method = await _detectInstallMethod();
      expect(method.type).toBe("local");
      if (method.type === "local") expect(method.manualHint).toContain("pnpm");
    });

    test("detects local install with yarn.lock", async () => {
      const dir = join(tempDir, "project-yarn");
      mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(dir, "package.json"), "{}");
      writeFileSync(join(dir, "yarn.lock"), "");
      setExecPath(join(dir, "node_modules", ".bin", "archgate"));
      const method = await _detectInstallMethod();
      expect(method.type).toBe("local");
      if (method.type === "local") expect(method.manualHint).toContain("yarn");
    });

    test("detects local install with package-lock.json", async () => {
      const dir = join(tempDir, "project-npm");
      mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(dir, "package.json"), "{}");
      writeFileSync(join(dir, "package-lock.json"), "{}");
      setExecPath(join(dir, "node_modules", ".bin", "archgate"));
      const method = await _detectInstallMethod();
      expect(method.type).toBe("local");
      if (method.type === "local") expect(method.manualHint).toContain("npm");
    });

    test("falls back to package-manager for unknown location", async () => {
      setExecPath(join(tempDir, "some", "random", "path", "archgate"));
      const method = await _detectInstallMethod();
      expect(method.type).toBe("package-manager");
    });

    test("binary detection takes priority over other methods", async () => {
      setExecPath(join(tempDir, ".archgate", "bin", "archgate"));
      const method = await _detectInstallMethod();
      expect(method.type).toBe("binary");
    });
  });
});

// ---------------------------------------------------------------------------
// Pure helpers: formatBytes, createDownloadProgress
// ---------------------------------------------------------------------------

describe("_formatBytes", () => {
  test.each([
    [0, "0 B"],
    [512, "512 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1024 * 100, "100.0 KB"],
    [1024 * 1024, "1.0 MB"],
    [1024 * 1024 * 5.5, "5.5 MB"],
    [1024 * 1024 * 100, "100.0 MB"],
  ])("formats %p bytes as %p", (input, expected) => {
    expect(_formatBytes(input)).toBe(expected);
  });
});

describe("_createDownloadProgress", () => {
  test("returns undefined when stderr is not a TTY", () => {
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
  let logSpy: Mock<typeof console.log>;
  let exitSpy: Mock<typeof process.exit>;
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

  function mockGitHubRelease(tag: string | null) {
    // Deliberately incomplete fake Response: only the fields
    // fetchLatestGitHubVersion actually reads (ok/status/json) need real
    // values; the rest of the real Response shape is inert filler here.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = (async () => ({
      ok: tag !== null,
      status: tag === null ? 500 : 200,
      json: async () => (tag !== null && tag !== "" ? { tag_name: tag } : {}),
    })) as unknown as typeof fetch;
  }

  test("prints already up-to-date when current version >= latest", async () => {
    // package.json version is 0.36.3; returning same version = up-to-date
    mockGitHubRelease("v0.36.3");
    const program = makeProgram();
    // exitWith(0) → process.exit(0) → throws "process.exit"
    expect(program.parseAsync(["node", "test", "upgrade"])).rejects.toThrow(
      "process.exit"
    );
    const out = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(out).toContain("already up-to-date");
  });

  test("prints error and exits 1 when version fetch fails", async () => {
    mockGitHubRelease(null);
    const program = makeProgram();
    // exitWith(1) → process.exit(1) → throws "process.exit"
    expect(program.parseAsync(["node", "test", "upgrade"])).rejects.toThrow(
      "process.exit"
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("treats older remote version as up-to-date", async () => {
    mockGitHubRelease("v0.1.0");
    const program = makeProgram();
    // exitWith(0) → process.exit(0) → throws "process.exit"
    expect(program.parseAsync(["node", "test", "upgrade"])).rejects.toThrow(
      "process.exit"
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
    const out = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(out).toContain("already up-to-date");
  });

  test("exits 2 when fetch throws a network error (unexpected)", async () => {
    // Deliberately incomplete fake fetch: only needs to reject; the rest of
    // the real fetch shape is unused.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = (async () => {
      throw new Error("network error");
    }) as unknown as typeof fetch;
    const program = makeProgram();
    // exitWith(2) → process.exit(2) → throws "process.exit"
    expect(program.parseAsync(["node", "test", "upgrade"])).rejects.toThrow(
      "process.exit"
    );
    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});
