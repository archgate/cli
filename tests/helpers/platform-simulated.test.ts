// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  type Mock,
  spyOn,
} from "bun:test";
import * as fs from "node:fs";

import {
  getPlatformInfo,
  isLinux,
  isMacOS,
  isSupportedPlatform,
  isWSL,
  isWindows,
  resolveCommand,
  getWindowsHomeDirFromWSL,
  _resetAllCaches,
} from "../../src/helpers/platform";
import { restoreEnv } from "../test-utils";

// `getPlatformInfo()` reads `process.platform` at call time and caches the
// answer, and Bun exposes that property as writable. Simulating it and clearing
// the cache reaches the macOS, WSL and native-Windows branches from any runner,
// which a `skipIf` gate on the real OS cannot do — a skipped test contributes
// to neither platform's coverage.

/** The `process.platform` descriptor, captured before any simulation. */
function platformDescriptor(): PropertyDescriptor {
  return Object.getOwnPropertyDescriptor(process, "platform")!;
}

function simulatePlatform(desc: PropertyDescriptor, runtime: string): void {
  Object.defineProperty(process, "platform", { ...desc, value: runtime });
}

describe("platform predicates across simulated platforms", () => {
  let platformDesc: PropertyDescriptor;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    platformDesc = platformDescriptor();
    savedEnv = {
      WSL_DISTRO_NAME: process.env.WSL_DISTRO_NAME,
      WSL_INTEROP: process.env.WSL_INTEROP,
    };
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", platformDesc);
    restoreEnv("WSL_DISTRO_NAME", savedEnv.WSL_DISTRO_NAME);
    restoreEnv("WSL_INTEROP", savedEnv.WSL_INTEROP);
    _resetAllCaches();
  });

  // [runtime, isWindows, isMacOS, isLinux, isSupportedPlatform]
  const predicateCases = [
    ["win32", true, false, false, true],
    ["darwin", false, true, false, true],
    ["linux", false, false, true, true],
    ["freebsd", false, false, false, false],
    ["aix", false, false, false, false],
  ] as const;

  test.each(predicateCases)(
    "reports %s as windows=%p macos=%p linux=%p supported=%p",
    (runtime, windows, macos, linux, supported) => {
      simulatePlatform(platformDesc, runtime);
      delete process.env.WSL_DISTRO_NAME;
      delete process.env.WSL_INTEROP;
      _resetAllCaches();

      expect(getPlatformInfo().runtime).toBe(runtime);
      expect(isWindows()).toBe(windows);
      expect(isMacOS()).toBe(macos);
      expect(isLinux()).toBe(linux);
      expect(isSupportedPlatform()).toBe(supported);
    }
  );
});

describe("WSL detection via /proc/version", () => {
  let platformDesc: PropertyDescriptor;
  let savedEnv: Record<string, string | undefined>;
  let readFileSyncSpy: Mock<typeof fs.readFileSync>;

  beforeEach(() => {
    platformDesc = platformDescriptor();
    savedEnv = {
      WSL_DISTRO_NAME: process.env.WSL_DISTRO_NAME,
      WSL_INTEROP: process.env.WSL_INTEROP,
    };
    readFileSyncSpy = spyOn(fs, "readFileSync");
    // Linux with no WSL environment variables: detection has to fall back to
    // reading /proc/version, which is what each case below controls.
    simulatePlatform(platformDesc, "linux");
    delete process.env.WSL_DISTRO_NAME;
    delete process.env.WSL_INTEROP;
  });

  afterEach(() => {
    readFileSyncSpy.mockRestore();
    Object.defineProperty(process, "platform", platformDesc);
    restoreEnv("WSL_DISTRO_NAME", savedEnv.WSL_DISTRO_NAME);
    restoreEnv("WSL_INTEROP", savedEnv.WSL_INTEROP);
    _resetAllCaches();
  });

  // The fallback exists for WSL1, which sets neither WSL_DISTRO_NAME nor
  // WSL_INTEROP; the kernel banner is the only marker left, and the casing of
  // "microsoft" in it has varied across releases.
  const procVersions = [
    [
      "a Microsoft-branded WSL1 kernel",
      "Linux version 4.4.0-19041-Microsoft",
      true,
    ],
    [
      "a lowercase microsoft banner",
      "Linux version 5.15.0-microsoft-standard",
      true,
    ],
    [
      "a stock upstream kernel",
      "Linux version 6.8.0-45-generic (buildd)",
      false,
    ],
  ] as const;

  test.each(procVersions)("detects %s", (_label, procVersion, expected) => {
    readFileSyncSpy.mockReturnValue(procVersion);
    _resetAllCaches();

    const info = getPlatformInfo();

    expect(info.isWSL).toBe(expected);
    expect(info.wslDistro).toBeNull();
    expect(isWSL()).toBe(expected);
  });

  test("treats an unreadable /proc/version as not WSL", () => {
    readFileSyncSpy.mockImplementation(() => {
      throw new Error(
        "ENOENT: no such file or directory, open '/proc/version'"
      );
    });
    _resetAllCaches();

    expect(getPlatformInfo().isWSL).toBe(false);
  });
});

describe("getWindowsHomeDirFromWSL in simulated WSL", () => {
  let platformDesc: PropertyDescriptor;
  let savedEnv: Record<string, string | undefined>;
  let spawnSpy: Mock<typeof Bun.spawn>;

  beforeEach(() => {
    platformDesc = platformDescriptor();
    savedEnv = {
      WSL_DISTRO_NAME: process.env.WSL_DISTRO_NAME,
      WSL_INTEROP: process.env.WSL_INTEROP,
    };
    spawnSpy = spyOn(Bun, "spawn");
    simulatePlatform(platformDesc, "linux");
    process.env.WSL_DISTRO_NAME = "Ubuntu-22.04";
    _resetAllCaches();
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    Object.defineProperty(process, "platform", platformDesc);
    restoreEnv("WSL_DISTRO_NAME", savedEnv.WSL_DISTRO_NAME);
    restoreEnv("WSL_INTEROP", savedEnv.WSL_INTEROP);
    _resetAllCaches();
  });

  /** Stub the `cmd.exe` probe; `wslpath -u` always converts successfully. */
  function stubCmdExe(stdout: string, exitCode: number): void {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    spawnSpy.mockImplementation(((cmd: string[]) => {
      if (cmd[0] === "wslpath") {
        return {
          stdout: "/mnt/c/Users/simulated\n",
          stderr: "",
          exited: Promise.resolve(0),
        };
      }
      return { stdout, stderr: "", exited: Promise.resolve(exitCode) };
    }) as unknown as typeof Bun.spawn);
  }

  // [label, cmd.exe stdout, cmd.exe exit code, resolved Windows home]
  const probeCases = [
    [
      "converts the USERPROFILE it prints",
      "C:\\Users\\simulated\r\n",
      0,
      "/mnt/c/Users/simulated",
    ],
    ["gives up when cmd.exe exits non-zero", "C:\\Users\\simulated", 1, null],
    ["gives up when the output is blank", "  \n", 0, null],
    ["gives up when USERPROFILE stays unexpanded", "%USERPROFILE%\n", 0, null],
  ] as const;

  test.each(probeCases)("%s", async (_label, stdout, exitCode, expected) => {
    stubCmdExe(stdout, exitCode);

    expect(await getWindowsHomeDirFromWSL()).toBe(expected);
  });

  test("caches the resolved home across calls", async () => {
    stubCmdExe("C:\\Users\\simulated\r\n", 0);

    const first = await getWindowsHomeDirFromWSL();
    const callsAfterFirst = spawnSpy.mock.calls.length;
    const second = await getWindowsHomeDirFromWSL();

    expect(second).toBe(first);
    expect(spawnSpy.mock.calls).toHaveLength(callsAfterFirst);
  });
});

describe("resolveCommand on simulated native Windows", () => {
  let platformDesc: PropertyDescriptor;
  let spawnSpy: Mock<typeof Bun.spawn>;
  let whichSpy: Mock<typeof Bun.which>;

  beforeEach(() => {
    platformDesc = platformDescriptor();
    simulatePlatform(platformDesc, "win32");
    spawnSpy = spyOn(Bun, "spawn");
    // Nothing resolves on the native PATH, so every case reaches the WSL probe.
    whichSpy = spyOn(Bun, "which").mockReturnValue(null);
    _resetAllCaches();
  });

  afterEach(() => {
    whichSpy.mockRestore();
    spawnSpy.mockRestore();
    Object.defineProperty(process, "platform", platformDesc);
    _resetAllCaches();
  });

  // [label, `wsl which <name>` exit code, resolved command]
  const wslProbeCases = [
    ["resolves the command when the wsl probe succeeds", 0, "ripgrep"],
    ["returns null when the wsl probe reports failure", 1, null],
  ] as const;

  test.each(wslProbeCases)("%s", async (_label, exitCode, expected) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    spawnSpy.mockImplementation((() => ({
      stdout: "",
      stderr: "",
      exited: Promise.resolve(exitCode),
    })) as unknown as typeof Bun.spawn);

    expect(await resolveCommand("ripgrep")).toBe(expected);
  });

  test("kills the wsl probe and returns null when it hangs", async () => {
    let settle: ((exitCode: number) => void) | undefined;
    const neverExits = new Promise<number>((resolve) => {
      settle = resolve;
    });
    let killed = false;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    spawnSpy.mockImplementation((() => ({
      stdout: "",
      stderr: "",
      exited: neverExits,
      kill: () => {
        killed = true;
      },
    })) as unknown as typeof Bun.spawn);

    try {
      // The production race gives the probe 3s before killing it.
      expect(await resolveCommand("ripgrep")).toBeNull();
      expect(killed).toBe(true);
    } finally {
      settle?.(0);
    }
  });

  test("returns null when spawning wsl throws", async () => {
    spawnSpy.mockImplementation(() => {
      throw new Error("wsl is not recognized as an internal command");
    });

    expect(await resolveCommand("ripgrep")).toBeNull();
  });
});
