// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, afterEach, mock } from "bun:test";

import { withPromptFix, _resetPatchState } from "../../src/helpers/prompt";

// Save the original write so we can verify restoration.
const originalWrite = process.stdout.write;

afterEach(() => {
  // Safety: ensure process.stdout.write is always restored even if a test fails.
  process.stdout.write = originalWrite;
  _resetPatchState();
  mock.restore();
});

describe("ensureStdoutNewlinePatch", () => {
  test("replaces bare LF with CRLF on Windows", () => {
    // Force isWindows() to return true by mocking the platform module.
    mock.module("../../src/helpers/platform", () => ({
      isWindows: () => true,
      isMacOS: () => false,
      isLinux: () => false,
      isWSL: () => false,
      getPlatformInfo: () => ({
        runtime: "win32" as const,
        isWSL: false,
        wslDistro: null,
      }),
    }));

    // Re-import to pick up mock
    const {
      ensureStdoutNewlinePatch: ensurePatch,
      _resetPatchState: resetPatch,
    } = require("../../src/helpers/prompt");
    resetPatch();

    const written: string[] = [];
    process.stdout.write = ((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    ensurePatch();

    // Call the patched write — bare \n should become \r\n
    process.stdout.write("hello\nworld\n");

    expect(written).toEqual(["hello\r\nworld\r\n"]);
  });

  test("does not double-replace existing CRLF", () => {
    mock.module("../../src/helpers/platform", () => ({
      isWindows: () => true,
      isMacOS: () => false,
      isLinux: () => false,
      isWSL: () => false,
      getPlatformInfo: () => ({
        runtime: "win32" as const,
        isWSL: false,
        wslDistro: null,
      }),
    }));

    const {
      ensureStdoutNewlinePatch: ensurePatch,
      _resetPatchState: resetPatch,
    } = require("../../src/helpers/prompt");
    resetPatch();

    const written: string[] = [];
    process.stdout.write = ((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    ensurePatch();
    process.stdout.write("line1\r\nline2\n");

    // \r\n stays as \r\n, bare \n becomes \r\n
    expect(written).toEqual(["line1\r\nline2\r\n"]);
  });

  test("is a no-op on non-Windows platforms", () => {
    mock.module("../../src/helpers/platform", () => ({
      isWindows: () => false,
      isMacOS: () => true,
      isLinux: () => false,
      isWSL: () => false,
      getPlatformInfo: () => ({
        runtime: "darwin" as const,
        isWSL: false,
        wslDistro: null,
      }),
    }));

    const {
      ensureStdoutNewlinePatch: ensurePatch,
      _resetPatchState: resetPatch,
    } = require("../../src/helpers/prompt");
    resetPatch();

    ensurePatch();

    // Write should not have been replaced
    expect(process.stdout.write).toBe(originalWrite);
  });

  test("is idempotent — second call does not re-patch", () => {
    mock.module("../../src/helpers/platform", () => ({
      isWindows: () => true,
      isMacOS: () => false,
      isLinux: () => false,
      isWSL: () => false,
      getPlatformInfo: () => ({
        runtime: "win32" as const,
        isWSL: false,
        wslDistro: null,
      }),
    }));

    const {
      ensureStdoutNewlinePatch: ensurePatch,
      _resetPatchState: resetPatch,
    } = require("../../src/helpers/prompt");
    resetPatch();

    ensurePatch();
    const afterFirstPatch = process.stdout.write;

    ensurePatch();
    // Second call should be a no-op — same patched function
    expect(process.stdout.write).toBe(afterFirstPatch);
  });
});

describe("withPromptFix", () => {
  test("returns the value from the wrapped function", async () => {
    const result = await withPromptFix(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  test("propagates errors from the wrapped function", async () => {
    await expect(
      withPromptFix(() => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
  });
});
