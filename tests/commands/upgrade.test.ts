import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerUpgradeCommand } from "../../src/commands/upgrade";

describe("registerUpgradeCommand", () => {
  test("registers 'upgrade' as a subcommand", () => {
    const program = new Command();
    registerUpgradeCommand(program);
    const sub = program.commands.find((c) => c.name() === "upgrade");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerUpgradeCommand(program);
    const sub = program.commands.find((c) => c.name() === "upgrade")!;
    expect(sub.description()).toBeTruthy();
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
    Object.defineProperty(process, "execPath", {
      value: originalExecPath,
      writable: true,
      configurable: true,
    });
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (originalProtoHome === undefined) delete process.env.PROTO_HOME;
    else process.env.PROTO_HOME = originalProtoHome;
    rmSync(tempDir, { recursive: true, force: true });
  });

  function setExecPath(path: string) {
    Object.defineProperty(process, "execPath", {
      value: path,
      writable: true,
      configurable: true,
    });
  }

  describe("_isBinaryInstall", () => {
    test("returns true when execPath is under ~/.archgate/bin/", async () => {
      const fakeBinary = join(tempDir, ".archgate", "bin", "archgate");
      setExecPath(fakeBinary);

      const { _isBinaryInstall } = await import(
        `../../src/commands/upgrade?t=${Date.now()}`
      );
      expect(_isBinaryInstall()).toBe(true);
    });

    test("returns false when execPath is elsewhere", async () => {
      setExecPath(join(tempDir, "usr", "local", "bin", "archgate"));

      const { _isBinaryInstall } = await import(
        `../../src/commands/upgrade?t=${Date.now()}`
      );
      expect(_isBinaryInstall()).toBe(false);
    });
  });

  describe("_isProtoInstall", () => {
    test("returns true when execPath is under ~/.proto/tools/archgate/", async () => {
      const fakeBinary = join(
        tempDir,
        ".proto",
        "tools",
        "archgate",
        "0.13.0",
        "archgate"
      );
      setExecPath(fakeBinary);

      const { _isProtoInstall } = await import(
        `../../src/commands/upgrade?t=${Date.now()}`
      );
      expect(_isProtoInstall()).toBe(true);
    });

    test("respects PROTO_HOME env var", async () => {
      const customProto = join(tempDir, "custom-proto");
      process.env.PROTO_HOME = customProto;
      const fakeBinary = join(
        customProto,
        "tools",
        "archgate",
        "0.13.0",
        "archgate"
      );
      setExecPath(fakeBinary);

      const { _isProtoInstall } = await import(
        `../../src/commands/upgrade?t=${Date.now()}`
      );
      expect(_isProtoInstall()).toBe(true);
    });

    test("returns false when execPath is elsewhere", async () => {
      setExecPath(join(tempDir, "usr", "local", "bin", "archgate"));

      const { _isProtoInstall } = await import(
        `../../src/commands/upgrade?t=${Date.now()}`
      );
      expect(_isProtoInstall()).toBe(false);
    });
  });

  describe("_isLocalInstall", () => {
    test("returns true when execPath contains node_modules", async () => {
      setExecPath(join(tempDir, "project", "node_modules", ".bin", "archgate"));

      const { _isLocalInstall } = await import(
        `../../src/commands/upgrade?t=${Date.now()}`
      );
      expect(_isLocalInstall()).toBe(true);
    });

    test("returns false when execPath has no node_modules", async () => {
      setExecPath(join(tempDir, "usr", "local", "bin", "archgate"));

      const { _isLocalInstall } = await import(
        `../../src/commands/upgrade?t=${Date.now()}`
      );
      expect(_isLocalInstall()).toBe(false);
    });
  });

  describe("_detectInstallMethod", () => {
    test("detects binary install", async () => {
      const fakeBinary = join(tempDir, ".archgate", "bin", "archgate");
      setExecPath(fakeBinary);

      const { _detectInstallMethod } = await import(
        `../../src/commands/upgrade?t=${Date.now()}`
      );
      const method = await _detectInstallMethod();
      expect(method.type).toBe("binary");
      expect(method).toHaveProperty("binaryPath", fakeBinary);
    });

    test("detects proto install", async () => {
      const fakeBinary = join(
        tempDir,
        ".proto",
        "tools",
        "archgate",
        "0.13.0",
        "archgate"
      );
      setExecPath(fakeBinary);

      const { _detectInstallMethod } = await import(
        `../../src/commands/upgrade?t=${Date.now()}`
      );
      const method = await _detectInstallMethod();
      expect(method.type).toBe("proto");
      expect(method).toHaveProperty("protoCmd");
    });

    test("detects local install with bun.lock", async () => {
      const projectDir = join(tempDir, "project-bun");
      mkdirSync(join(projectDir, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(projectDir, "package.json"), "{}");
      writeFileSync(join(projectDir, "bun.lock"), "");
      setExecPath(join(projectDir, "node_modules", ".bin", "archgate"));

      const { _detectInstallMethod } = await import(
        `../../src/commands/upgrade?t=${Date.now()}`
      );
      const method = await _detectInstallMethod();
      expect(method.type).toBe("local");
      expect(method.manualHint).toContain("bun");
    });

    test("detects local install with pnpm-lock.yaml", async () => {
      const projectDir = join(tempDir, "project-pnpm");
      mkdirSync(join(projectDir, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(projectDir, "package.json"), "{}");
      writeFileSync(join(projectDir, "pnpm-lock.yaml"), "");
      setExecPath(join(projectDir, "node_modules", ".bin", "archgate"));

      const { _detectInstallMethod } = await import(
        `../../src/commands/upgrade?t=${Date.now()}`
      );
      const method = await _detectInstallMethod();
      expect(method.type).toBe("local");
      expect(method.manualHint).toContain("pnpm");
    });

    test("detects local install with yarn.lock", async () => {
      const projectDir = join(tempDir, "project-yarn");
      mkdirSync(join(projectDir, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(projectDir, "package.json"), "{}");
      writeFileSync(join(projectDir, "yarn.lock"), "");
      setExecPath(join(projectDir, "node_modules", ".bin", "archgate"));

      const { _detectInstallMethod } = await import(
        `../../src/commands/upgrade?t=${Date.now()}`
      );
      const method = await _detectInstallMethod();
      expect(method.type).toBe("local");
      expect(method.manualHint).toContain("yarn");
    });

    test("detects local install with package-lock.json", async () => {
      const projectDir = join(tempDir, "project-npm");
      mkdirSync(join(projectDir, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(projectDir, "package.json"), "{}");
      writeFileSync(join(projectDir, "package-lock.json"), "{}");
      setExecPath(join(projectDir, "node_modules", ".bin", "archgate"));

      const { _detectInstallMethod } = await import(
        `../../src/commands/upgrade?t=${Date.now()}`
      );
      const method = await _detectInstallMethod();
      expect(method.type).toBe("local");
      expect(method.manualHint).toContain("npm");
    });

    test("falls back to package-manager for unknown location", async () => {
      setExecPath(join(tempDir, "some", "random", "path", "archgate"));

      const { _detectInstallMethod } = await import(
        `../../src/commands/upgrade?t=${Date.now()}`
      );
      const method = await _detectInstallMethod();
      expect(method.type).toBe("package-manager");
    });

    test("binary detection takes priority over other methods", async () => {
      const fakeBinary = join(tempDir, ".archgate", "bin", "archgate");
      setExecPath(fakeBinary);

      const { _detectInstallMethod } = await import(
        `../../src/commands/upgrade?t=${Date.now()}`
      );
      const method = await _detectInstallMethod();
      expect(method.type).toBe("binary");
    });
  });
});
