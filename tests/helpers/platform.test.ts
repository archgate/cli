// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";

import {
  getPlatformInfo,
  isWSL,
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

  test("re-detection after cache reset returns consistent values", () => {
    const first = getPlatformInfo();
    _resetAllCaches();
    const second = getPlatformInfo();
    // Values should be the same even though references differ
    expect(second.runtime).toBe(first.runtime);
    expect(second.isWSL).toBe(first.isWSL);
    expect(second.wslDistro).toBe(first.wslDistro);
  });
});

describe("isWSL", () => {
  beforeEach(() => _resetAllCaches());
  afterEach(() => _resetAllCaches());

  test("returns a boolean", () => {
    expect(typeof isWSL()).toBe("boolean");
  });

  test("is consistent with getPlatformInfo().isWSL", () => {
    expect(isWSL()).toBe(getPlatformInfo().isWSL);
  });
});

describe("resolveCommand", () => {
  test("returns null for non-existent command", async () => {
    const result = await resolveCommand("definitely-not-a-real-command-xyz123");
    expect(result).toBeNull();
  });

  test("returns null for another non-existent command", async () => {
    const result = await resolveCommand(
      "no-such-tool-abcdef-999-should-not-exist"
    );
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

  test.skipIf(inWSL)("returns null when not in WSL", async () => {
    const result = await toWindowsPath("/some/path");
    expect(result).toBeNull();
  });

  test.skipIf(inWSL)("returns null on non-WSL for absolute path", async () => {
    const result = await toWindowsPath("/mnt/c/Users/test");
    expect(result).toBeNull();
  });
});

describe("toWslPath", () => {
  beforeEach(() => _resetAllCaches());
  afterEach(() => _resetAllCaches());

  test.skipIf(!inWSL)("converts C:\\ to /mnt/c", async () => {
    const result = await toWslPath("C:\\");
    expect(result).toBe("/mnt/c/");
  });

  test.skipIf(inWSL)("returns null when not in WSL", async () => {
    const result = await toWslPath("C:\\Users");
    expect(result).toBeNull();
  });

  test.skipIf(inWSL)(
    "returns null on non-WSL for Windows-style path",
    async () => {
      const result = await toWslPath("D:\\Projects\\foo");
      expect(result).toBeNull();
    }
  );
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

  test.skipIf(inWSL)("returns null when not in WSL", async () => {
    const result = await getWindowsHomeDirFromWSL();
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WSL detection via env-var mocking (runs on Linux CI without real WSL)
// ---------------------------------------------------------------------------

describe("WSL detection via env vars (Linux only)", () => {
  const isNativeLinux =
    process.platform === "linux" && !process.env.WSL_DISTRO_NAME;

  let savedDistro: string | undefined;
  let savedInterop: string | undefined;

  beforeEach(() => {
    savedDistro = process.env.WSL_DISTRO_NAME;
    savedInterop = process.env.WSL_INTEROP;
    _resetAllCaches();
  });

  afterEach(() => {
    if (savedDistro === undefined) delete process.env.WSL_DISTRO_NAME;
    else process.env.WSL_DISTRO_NAME = savedDistro;
    if (savedInterop === undefined) delete process.env.WSL_INTEROP;
    else process.env.WSL_INTEROP = savedInterop;
    _resetAllCaches();
  });

  test.skipIf(!isNativeLinux)("detects WSL via WSL_DISTRO_NAME", () => {
    process.env.WSL_DISTRO_NAME = "Ubuntu-22.04";
    _resetAllCaches();
    const info = getPlatformInfo();
    expect(info.isWSL).toBe(true);
    expect(info.wslDistro).toBe("Ubuntu-22.04");
    expect(isWSL()).toBe(true);
  });

  test.skipIf(!isNativeLinux)(
    "detects WSL via WSL_INTEROP when WSL_DISTRO_NAME is absent",
    () => {
      delete process.env.WSL_DISTRO_NAME;
      process.env.WSL_INTEROP = "/run/WSL/1_interop";
      _resetAllCaches();
      const info = getPlatformInfo();
      expect(info.isWSL).toBe(true);
      expect(info.wslDistro).toBeNull();
    }
  );

  test.skipIf(!isNativeLinux)(
    "isWSL false when no WSL env vars are set",
    () => {
      delete process.env.WSL_DISTRO_NAME;
      delete process.env.WSL_INTEROP;
      _resetAllCaches();
      // On real Linux (not WSL), /proc/version won't contain "microsoft"
      expect(getPlatformInfo().isWSL).toBe(false);
    }
  );

  test.skipIf(!isNativeLinux)(
    "toWindowsPath returns null in fake WSL (no wslpath binary)",
    async () => {
      process.env.WSL_DISTRO_NAME = "FakeWSL";
      _resetAllCaches();
      // isWSL() returns true, but wslpath isn't available → returns null
      const result = await toWindowsPath("/mnt/c/Users");
      expect(result).toBeNull();
    }
  );

  test.skipIf(!isNativeLinux)(
    "toWslPath returns null in fake WSL (no wslpath binary)",
    async () => {
      process.env.WSL_DISTRO_NAME = "FakeWSL";
      _resetAllCaches();
      const result = await toWslPath("C:\\Users");
      expect(result).toBeNull();
    }
  );

  test.skipIf(!isNativeLinux)(
    "getWindowsHomeDirFromWSL returns null in fake WSL (no cmd.exe)",
    async () => {
      process.env.WSL_DISTRO_NAME = "FakeWSL";
      _resetAllCaches();
      const result = await getWindowsHomeDirFromWSL();
      expect(result).toBeNull();
    }
  );

  test.skipIf(!isNativeLinux)(
    "resolveCommand tries .exe variant in fake WSL",
    async () => {
      process.env.WSL_DISTRO_NAME = "FakeWSL";
      _resetAllCaches();
      // Neither "fake-tool" nor "fake-tool.exe" exist
      const result = await resolveCommand("fake-tool");
      expect(result).toBeNull();
    }
  );
});

describe("_resetAllCaches", () => {
  test("clears platform cache so next call re-detects", () => {
    const first = getPlatformInfo();
    _resetAllCaches();
    const second = getPlatformInfo();
    expect(first).not.toBe(second);
    // Values remain the same — the platform hasn't changed
    expect(second.runtime).toBe(first.runtime);
  });

  test("clears Windows home dir cache", async () => {
    // Call once to populate the cache.
    const before = await getWindowsHomeDirFromWSL();
    // Reset and re-detect — the platform hasn't changed, so the freshly
    // detected value must match the previously cached one.
    _resetAllCaches();
    const after = await getWindowsHomeDirFromWSL();
    expect(after).toBe(before);
  });

  test.skipIf(inWSL)(
    "returns null after cache reset when not in WSL",
    async () => {
      _resetAllCaches();
      const result = await getWindowsHomeDirFromWSL();
      expect(result).toBeNull();
    }
  );
});
