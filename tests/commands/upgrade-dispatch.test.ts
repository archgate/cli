// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// ---------------------------------------------------------------------------
// Sibling of upgrade.test.ts / upgrade-action.test.ts, split out to stay under
// the 500-line lint cap. Covers global package-manager detection, the external
// (proto / package-manager) upgrade dispatch, and the TTY progress renderer.
// ---------------------------------------------------------------------------

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import {
  _createDownloadProgress,
  _detectInstallMethod,
  registerUpgradeCommand,
} from "../../src/commands/upgrade";
import * as binaryUpgrade from "../../src/helpers/binary-upgrade";
import * as credentialStore from "../../src/helpers/credential-store";
import * as exitModule from "../../src/helpers/exit";
import { internalPath } from "../../src/helpers/paths";
import * as platform from "../../src/helpers/platform";
import * as telemetryModule from "../../src/helpers/telemetry";
import { restoreEnv } from "../test-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setExecPath(path: string): void {
  Object.defineProperty(process, "execPath", {
    value: path,
    writable: true,
    configurable: true,
  });
}

function setIsTTY(
  stream: NodeJS.ReadStream | NodeJS.WriteStream,
  value: boolean | undefined
): void {
  Object.defineProperty(stream, "isTTY", { value, configurable: true });
}

/**
 * Fake Bun.spawn return value — only `stdout` and `exited` are read by
 * getGlobalBinDir/runExternalUpgrade; the rest is inert filler.
 */
function fakeSpawnResult(
  exitCode: number,
  stdout = ""
): ReturnType<typeof Bun.spawn> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return {
    stdout: new Response(stdout).body!,
    stderr: new Response("").body!,
    exited: Promise.resolve(exitCode),
    pid: 0,
    exitCode: null,
    signalCode: null,
    killed: false,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    stdin: null as never,
    ref: () => {},
    unref: () => {},
    kill: () => {},
    readable: new ReadableStream(),
    [Symbol.asyncDispose]: async () => {},
  } as unknown as ReturnType<typeof Bun.spawn>;
}

// ---------------------------------------------------------------------------
// Global package-manager detection
// ---------------------------------------------------------------------------

describe("_detectInstallMethod package-manager branches", () => {
  let tempDir: string;
  let globalBinDir: string;
  let originalExecPath: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalProtoHome: string | undefined;
  let resolveSpy: Mock<typeof platform.resolveCommand>;
  let spawnSpy: Mock<typeof Bun.spawn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-upgrade-pm-"));
    globalBinDir = join(tempDir, "global-bin");
    originalExecPath = process.execPath;
    originalHome = Bun.env.HOME;
    originalUserProfile = Bun.env.USERPROFILE;
    originalProtoHome = Bun.env.PROTO_HOME;
    Bun.env.HOME = tempDir;
    Bun.env.USERPROFILE = tempDir;
    delete Bun.env.PROTO_HOME;
    setExecPath(join(globalBinDir, "archgate"));

    resolveSpy = spyOn(platform, "resolveCommand").mockImplementation(
      async () => null
    );
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
      fakeSpawnResult(0, "")
    );
  });

  afterEach(() => {
    resolveSpy.mockRestore();
    spawnSpy.mockRestore();
    setExecPath(originalExecPath);
    restoreEnv("HOME", originalHome);
    restoreEnv("USERPROFILE", originalUserProfile);
    restoreEnv("PROTO_HOME", originalProtoHome);
    rmSync(tempDir, { recursive: true, force: true });
  });

  const PM_CASES = [
    ["bun", ["pm", "-g", "bin"], "bun add -g archgate@latest"],
    ["pnpm", ["bin", "-g"], "pnpm add -g archgate@latest"],
    ["yarn", ["global", "bin"], "yarn global add archgate@latest"],
    ["npm", ["bin", "-g"], "npm install -g archgate@latest"],
  ] as const;

  test.each(PM_CASES)(
    "detects a %s global install from its reported bin directory",
    async (name, globalBinArgs, expectedHint) => {
      resolveSpy.mockImplementation(async (cmd) =>
        cmd === name ? name : null
      );
      spawnSpy.mockImplementation(() =>
        fakeSpawnResult(0, `${globalBinDir}\n`)
      );

      const method = await _detectInstallMethod();

      expect(method.type).toBe("package-manager");
      expect(method).toHaveProperty("cmd", name);
      expect(method).toHaveProperty("manualHint", expectedHint);
      expect(spawnSpy).toHaveBeenCalledWith([name, ...globalBinArgs], {
        stdout: "pipe",
        stderr: "pipe",
      });
    }
  );

  test("falls back to npm when no bin directory contains the binary", async () => {
    resolveSpy.mockImplementation(async (cmd) => `/usr/bin/${cmd}`);
    spawnSpy.mockImplementation(() =>
      fakeSpawnResult(0, `${join(tempDir, "somewhere-else")}\n`)
    );

    const method = await _detectInstallMethod();

    expect(method).toHaveProperty("cmd", "/usr/bin/npm");
    expect(method).toHaveProperty(
      "manualHint",
      "npm install -g archgate@latest"
    );
  });

  test("skips a package manager whose bin-dir command exits non-zero", async () => {
    resolveSpy.mockImplementation(async (cmd) =>
      cmd === "bun" ? "bun" : null
    );
    spawnSpy.mockImplementation(() => fakeSpawnResult(1, `${globalBinDir}\n`));

    const method = await _detectInstallMethod();

    expect(method.type).toBe("package-manager");
    expect(method).toHaveProperty("cmd", "npm");
  });

  test("skips a package manager whose bin-dir command throws", async () => {
    resolveSpy.mockImplementation(async (cmd) =>
      cmd === "bun" ? "bun" : null
    );
    spawnSpy.mockImplementation(() => {
      throw new Error("spawn ENOENT");
    });

    const method = await _detectInstallMethod();

    expect(method).toHaveProperty("cmd", "npm");
  });

  test("skips a package manager that reports an empty bin directory", async () => {
    resolveSpy.mockImplementation(async (cmd) =>
      cmd === "bun" ? "bun" : null
    );
    spawnSpy.mockImplementation(() => fakeSpawnResult(0, "   \n"));

    const method = await _detectInstallMethod();

    expect(method).toHaveProperty("cmd", "npm");
  });

  test("skips a package manager that resolves to an empty command", async () => {
    resolveSpy.mockImplementation(async () => "");

    const method = await _detectInstallMethod();

    expect(method).toHaveProperty("cmd", "npm");
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  test("falls through to package-manager detection when no lockfile is present", async () => {
    const projectDir = join(tempDir, "proj");
    mkdirSync(join(projectDir, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(projectDir, "package.json"), "{}");
    setExecPath(join(projectDir, "node_modules", ".bin", "archgate"));

    const method = await _detectInstallMethod();

    expect(method.type).toBe("package-manager");
  });
});

// ---------------------------------------------------------------------------
// Download progress rendering (TTY only)
// ---------------------------------------------------------------------------

describe("_createDownloadProgress rendering", () => {
  let originalIsTTY: boolean | undefined;
  let writeSpy: Mock<typeof process.stderr.write>;
  let written: string[];

  beforeEach(() => {
    originalIsTTY = process.stderr.isTTY;
    setIsTTY(process.stderr, true);
    written = [];
    writeSpy = spyOn(process.stderr, "write").mockImplementation(
      (chunk: unknown) => {
        written.push(String(chunk));
        return true;
      }
    );
  });

  afterEach(() => {
    writeSpy.mockRestore();
    setIsTTY(process.stderr, originalIsTTY);
  });

  test("renders a percentage when the total size is known", () => {
    const onProgress = _createDownloadProgress();
    expect(onProgress).toBeDefined();

    onProgress!({ downloadedBytes: 512 * 1024, totalBytes: 1024 * 1024 });

    expect(written.join("")).toContain(
      "Downloading... 512.0 KB / 1.0 MB (50%)"
    );
  });

  test.each([[null], [0]])(
    "renders downloaded bytes only when totalBytes is %p",
    (totalBytes: number | null) => {
      const onProgress = _createDownloadProgress();

      onProgress!({ downloadedBytes: 2048, totalBytes });

      const output = written.join("");
      expect(output).toContain("Downloading... 2.0 KB");
      expect(output).not.toContain("%");
    }
  );
});

// ---------------------------------------------------------------------------
// Action dispatch: proto, package-manager, and semver comparison failure
// ---------------------------------------------------------------------------

describe("upgrade dispatch", () => {
  let tempDir: string;
  let logSpy: Mock<typeof console.log>;
  let errorSpy: Mock<typeof console.error>;
  let exitSpy: Mock<typeof exitModule.exitWith>;
  let fetchVersionSpy: Mock<typeof binaryUpgrade.fetchLatestGitHubVersion>;
  let trackSpy: Mock<typeof telemetryModule.trackUpgradeResult>;
  let credsSpy: Mock<typeof credentialStore.loadCredentials>;
  let resolveSpy: Mock<typeof platform.resolveCommand>;
  let spawnSpy: Mock<typeof Bun.spawn>;
  let originalExecPath: string;
  let originalStdinIsTTY: boolean | undefined;
  let originalStderrIsTTY: boolean | undefined;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalProtoHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-upgrade-dispatch-"));
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(exitModule, "exitWith").mockImplementation(() => {
      throw new Error("process.exit");
    });
    fetchVersionSpy = spyOn(
      binaryUpgrade,
      "fetchLatestGitHubVersion"
    ).mockResolvedValue("v99.0.0");
    trackSpy = spyOn(telemetryModule, "trackUpgradeResult").mockImplementation(
      () => {}
    );
    credsSpy = spyOn(credentialStore, "loadCredentials").mockResolvedValue(
      null
    );
    resolveSpy = spyOn(platform, "resolveCommand").mockImplementation(
      async (name) => name
    );
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() =>
      fakeSpawnResult(0, "")
    );

    originalExecPath = process.execPath;
    originalStdinIsTTY = process.stdin.isTTY;
    originalStderrIsTTY = process.stderr.isTTY;
    setIsTTY(process.stdin, false);
    originalHome = Bun.env.HOME;
    originalUserProfile = Bun.env.USERPROFILE;
    originalProtoHome = Bun.env.PROTO_HOME;
    Bun.env.HOME = tempDir;
    Bun.env.USERPROFILE = tempDir;
    delete Bun.env.PROTO_HOME;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    fetchVersionSpy.mockRestore();
    trackSpy.mockRestore();
    credsSpy.mockRestore();
    resolveSpy.mockRestore();
    spawnSpy.mockRestore();
    setExecPath(originalExecPath);
    setIsTTY(process.stdin, originalStdinIsTTY);
    setIsTTY(process.stderr, originalStderrIsTTY);
    restoreEnv("HOME", originalHome);
    restoreEnv("USERPROFILE", originalUserProfile);
    restoreEnv("PROTO_HOME", originalProtoHome);
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeProgram(): Command {
    const program = new Command().exitOverride();
    registerUpgradeCommand(program);
    return program;
  }

  function protoExecPath(): string {
    return join(tempDir, ".proto", "tools", "archgate", "99.0.0", "archgate");
  }

  function errorOutput(): string {
    return errorSpy.mock.calls
      .map((c: unknown[]) => c.map(String).join(" "))
      .join("\n");
  }

  /**
   * Run the command to completion and return the rejection message, so the
   * spy assertions that follow observe a settled action.
   */
  async function runUpgrade(program: Command): Promise<string> {
    try {
      await program.parseAsync(["node", "test", "upgrade"]);
      return "";
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  test("runs the proto upgrade command for a proto install", async () => {
    setExecPath(protoExecPath());

    await makeProgram().parseAsync(["node", "test", "upgrade"]);

    expect(spawnSpy).toHaveBeenLastCalledWith(
      ["proto", "install", "archgate", "latest", "--pin"],
      { stdout: "inherit", stderr: "inherit" }
    );
    expect(trackSpy.mock.calls[0][0].install_method).toBe("proto");
  });

  test("exits 1 with a manual hint when the proto upgrade fails", async () => {
    setExecPath(protoExecPath());
    spawnSpy.mockImplementation(() => fakeSpawnResult(3, ""));

    expect(await runUpgrade(makeProgram())).toBe("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("proto install archgate latest --pin");
  });

  test("runs the package-manager upgrade command for a global install", async () => {
    setExecPath(join(tempDir, "elsewhere", "archgate"));

    await makeProgram().parseAsync(["node", "test", "upgrade"]);

    expect(spawnSpy).toHaveBeenLastCalledWith(
      ["npm", "install", "-g", "archgate@latest"],
      { stdout: "inherit", stderr: "inherit" }
    );
    expect(trackSpy.mock.calls[0][0].install_method).toBe("package-manager");
  });

  test("exits 1 with a manual hint when the package-manager upgrade fails", async () => {
    setExecPath(join(tempDir, "elsewhere", "archgate"));
    // Every spawn fails: the bin-dir probes yield no match (so detection falls
    // back to npm) and the npm upgrade itself exits non-zero.
    spawnSpy.mockImplementation(() => fakeSpawnResult(1, ""));

    expect(await runUpgrade(makeProgram())).toBe("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("npm install -g archgate@latest");
  });

  test("exits 2 when the release tag is not comparable semver", async () => {
    fetchVersionSpy.mockResolvedValue("vnot-a-version");

    expect(await runUpgrade(makeProgram())).toBe("process.exit");

    // semver.order() throws on an unparseable version, so the outer catch
    // records a failed upgrade and routes through handleCommandError → exit 2.
    expect(exitSpy.mock.calls.map((c) => c[0])).toContain(2);
    const failure = trackSpy.mock.calls.find((c) => !c[0].success);
    expect(failure).toBeDefined();
    expect(failure![0].install_method).toBe("unknown");
    expect(errorOutput()).toContain("Invalid SemVer");
  });

  test("clears the progress line after a TTY binary download", async () => {
    setExecPath(join(internalPath("bin"), "archgate"));
    setIsTTY(process.stderr, true);
    const writeSpy = spyOn(process.stderr, "write").mockImplementation(
      () => true
    );
    const artifactSpy = spyOn(binaryUpgrade, "getArtifactInfo").mockReturnValue(
      { name: "archgate-test-x64", ext: ".tar.gz", binaryName: "archgate" }
    );
    const downloadSpy = spyOn(
      binaryUpgrade,
      "downloadReleaseBinary"
    ).mockImplementation(async (_tag, _artifact, onProgress) => {
      onProgress?.({ downloadedBytes: 10, totalBytes: 100 });
      return join(tempDir, "new-binary");
    });
    const replaceSpy = spyOn(binaryUpgrade, "replaceBinary").mockImplementation(
      () => {}
    );

    try {
      await makeProgram().parseAsync(["node", "test", "upgrade"]);

      expect(downloadSpy.mock.calls[0][2]).toBeDefined();
      expect(replaceSpy).toHaveBeenCalledTimes(1);
      expect(writeSpy).toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
      artifactSpy.mockRestore();
      downloadSpy.mockRestore();
      replaceSpy.mockRestore();
    }
  });

  test("clears the progress line when a TTY binary download fails", async () => {
    setExecPath(join(internalPath("bin"), "archgate"));
    setIsTTY(process.stderr, true);
    const writeSpy = spyOn(process.stderr, "write").mockImplementation(
      () => true
    );
    const artifactSpy = spyOn(binaryUpgrade, "getArtifactInfo").mockReturnValue(
      { name: "archgate-test-x64", ext: ".tar.gz", binaryName: "archgate" }
    );
    const downloadSpy = spyOn(
      binaryUpgrade,
      "downloadReleaseBinary"
    ).mockRejectedValue(new Error("checksum mismatch"));

    try {
      expect(await runUpgrade(makeProgram())).toBe("process.exit");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorOutput()).toContain("checksum mismatch");
    } finally {
      writeSpy.mockRestore();
      artifactSpy.mockRestore();
      downloadSpy.mockRestore();
    }
  });
});
