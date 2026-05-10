// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";

import {
  getPlatformInfo,
  isWSL,
  isWindows,
  isMacOS,
  isLinux,
  isSupportedPlatform,
  resolveCommand,
  toWindowsPath,
  toWslPath,
  getWindowsHomeDirFromWSL,
  _resetAllCaches,
} from "../../src/helpers/platform";

describe("getPlatformInfo", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      WSL_DISTRO_NAME: process.env.WSL_DISTRO_NAME,
      WSL_INTEROP: process.env.WSL_INTEROP,
    };
    _resetAllCaches();
  });

  afterEach(() => {
    process.env.WSL_DISTRO_NAME = savedEnv.WSL_DISTRO_NAME;
    process.env.WSL_INTEROP = savedEnv.WSL_INTEROP;
    _resetAllCaches();
  });

  test("returns a PlatformInfo object", () => {
    const info = getPlatformInfo();
    expect(info).toHaveProperty("runtime");
    expect(info).toHaveProperty("isWSL");
    expect(info).toHaveProperty("wslDistro");
  });

  test("runtime matches process.platform", () => {
    const info = getPlatformInfo();
    expect(info.runtime).toBe(process.platform);
  });

  test("caches result across calls", () => {
    const first = getPlatformInfo();
    const second = getPlatformInfo();
    expect(first).toBe(second); // same reference
  });

  test("cache is cleared by _resetAllCaches", () => {
    const first = getPlatformInfo();
    _resetAllCaches();
    const second = getPlatformInfo();
    // Different reference after cache reset (may have same values)
    expect(first).not.toBe(second);
  });

  test("isWSL is false on win32 and darwin", () => {
    if (process.platform === "win32" || process.platform === "darwin") {
      expect(getPlatformInfo().isWSL).toBe(false);
    }
  });
});

describe("isWSL", () => {
  beforeEach(() => _resetAllCaches());
  afterEach(() => _resetAllCaches());

  test("returns a boolean", () => {
    expect(typeof isWSL()).toBe("boolean");
  });
});

describe("platform shorthand helpers", () => {
  beforeEach(() => _resetAllCaches());
  afterEach(() => _resetAllCaches());

  test("isWindows matches process.platform", () => {
    expect(isWindows()).toBe(process.platform === "win32");
  });

  test("isMacOS matches process.platform", () => {
    expect(isMacOS()).toBe(process.platform === "darwin");
  });

  test("isLinux matches process.platform", () => {
    expect(isLinux()).toBe(process.platform === "linux");
  });

  test("isSupportedPlatform returns true on supported platforms", () => {
    expect(isSupportedPlatform()).toBe(
      ["darwin", "linux", "win32"].includes(process.platform)
    );
  });

  test("exactly one of isWindows/isMacOS/isLinux is true", () => {
    const checks = [isWindows(), isMacOS(), isLinux()];
    expect(checks.filter(Boolean).length).toBe(1);
  });
});

describe("resolveCommand", () => {
  test("finds bun on PATH", async () => {
    const result = await resolveCommand("bun");
    expect(result).toBe("bun");
  });

  test("returns null for non-existent command", async () => {
    const result = await resolveCommand("definitely-not-a-real-command-xyz123");
    expect(result).toBeNull();
  });
});

// WSL-only tests: path conversion and Windows home directory
const inWSL = !!process.env.WSL_DISTRO_NAME;

describe("toWindowsPath", () => {
  beforeEach(() => _resetAllCaches());
  afterEach(() => _resetAllCaches());

  test.skipIf(!inWSL)("converts /mnt/c to C:\\", async () => {
    const result = await toWindowsPath("/mnt/c");
    expect(result).toBe("C:\\");
  });

  test.skipIf(!inWSL)("converts WSL home path", async () => {
    const result = await toWindowsPath("/mnt/c/Users");
    expect(result).toMatch(/^C:\\Users$/u);
  });

  test("returns null when not in WSL", async () => {
    if (!inWSL) {
      const result = await toWindowsPath("/some/path");
      expect(result).toBeNull();
    }
  });
});

describe("toWslPath", () => {
  beforeEach(() => _resetAllCaches());
  afterEach(() => _resetAllCaches());

  test.skipIf(!inWSL)("converts C:\\ to /mnt/c", async () => {
    const result = await toWslPath("C:\\");
    expect(result).toBe("/mnt/c/");
  });

  test("returns null when not in WSL", async () => {
    if (!inWSL) {
      const result = await toWslPath("C:\\Users");
      expect(result).toBeNull();
    }
  });
});

describe("getWindowsHomeDirFromWSL", () => {
  beforeEach(() => _resetAllCaches());
  afterEach(() => _resetAllCaches());

  test.skipIf(!inWSL)("returns a path under /mnt/", async () => {
    const result = await getWindowsHomeDirFromWSL();
    expect(result).not.toBeNull();
    expect(result!).toMatch(/^\/mnt\//u);
  });

  test.skipIf(!inWSL)("caches the result", async () => {
    const first = await getWindowsHomeDirFromWSL();
    const second = await getWindowsHomeDirFromWSL();
    expect(first).toBe(second);
  });

  test("returns null when not in WSL", async () => {
    if (!inWSL) {
      const result = await getWindowsHomeDirFromWSL();
      expect(result).toBeNull();
    }
  });
});
