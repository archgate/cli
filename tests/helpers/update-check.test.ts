// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkForUpdatesIfNeeded,
  maybeCheckForUpdates,
  shouldPerformUpdateCheck,
} from "../../src/helpers/update-check";
import { restoreEnv } from "../test-utils";

// The module holds no mutable state, and every path it reads (HOME,
// globalThis.fetch) is resolved at call time, so one static import serves
// every test. A cache-busting `?t=` specifier would instead create a second
// module instance whose execution is not attributed to the real source file.

describe("shouldPerformUpdateCheck", () => {
  test("true in a genuine interactive terminal", () => {
    expect(
      shouldPerformUpdateCheck({
        argv: ["bun", "cli.ts", "session-context", "claude-code", "list"],
        isTTY: true,
        ci: false,
      })
    ).toBe(true);
  });

  test("false when CI is set, even on a TTY", () => {
    expect(
      shouldPerformUpdateCheck({
        argv: ["bun", "cli.ts", "session-context", "claude-code", "list"],
        isTTY: true,
        ci: true,
      })
    ).toBe(false);
  });

  test("false when stdout is not a TTY (piped/redirected output)", () => {
    expect(
      shouldPerformUpdateCheck({
        argv: ["bun", "cli.ts", "session-context", "claude-code", "list"],
        isTTY: false,
        ci: false,
      })
    ).toBe(false);
  });

  test("false for the upgrade command itself, even on an interactive TTY", () => {
    expect(
      shouldPerformUpdateCheck({
        argv: ["bun", "cli.ts", "upgrade"],
        isTTY: true,
        ci: false,
      })
    ).toBe(false);
  });
});

describe("checkForUpdatesIfNeeded", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalFetch: typeof globalThis.fetch;
  const originalBunWrite = Bun.write;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-update-check-test-"));
    originalHome = process.env.HOME;
    originalFetch = globalThis.fetch;
    process.env.HOME = tempDir;
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* temp dir may already be removed */
    }
    restoreEnv("HOME", originalHome);
    // mock.restore() does not undo a direct assignment (ARCH-005).
    globalThis.fetch = originalFetch;
    Bun.write = originalBunWrite;
    mock.restore();
  });

  test("returns null when fetch fails", async () => {
    // Deliberately incomplete fake: only the call signature fetch invokes
    // matters for this test.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = (async () => {
      throw new Error("network error");
    }) as unknown as typeof fetch;

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).toBeNull();
  });

  test("returns null when already up-to-date", async () => {
    const mockFetch = mock(async () => ({
      ok: true,
      json: async () => ({ tag_name: "v0.1.0" }),
    }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).toBeNull();
  });

  test("returns notice string when update is available", async () => {
    const mockFetch = mock(async () => ({
      ok: true,
      json: async () => ({ tag_name: "v0.2.0" }),
    }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).not.toBeNull();
    expect(result).toContain("0.1.0");
    expect(result).toContain("0.2.0");
    expect(result).toContain("archgate upgrade");
  });

  test("returns null when GitHub API returns non-ok response", async () => {
    const mockFetch = mock(async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).toBeNull();
  });

  test("returns null when tag_name is missing from response", async () => {
    const mockFetch = mock(async () => ({ ok: true, json: async () => ({}) }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).toBeNull();
  });

  test("skips check when cache is recent", async () => {
    const cacheDir = join(tempDir, ".archgate");
    await Bun.write(join(cacheDir, "last-update-check"), String(Date.now()));
    const fetchSpy = mock(async () => ({ ok: true }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("creates cache file when no cache exists", async () => {
    const cacheFile = join(tempDir, ".archgate", "last-update-check");
    expect(existsSync(cacheFile)).toBe(false);
    const mockFetch = mock(async () => ({
      ok: true,
      json: async () => ({ tag_name: "v0.2.0" }),
    }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).toContain("0.2.0");
    expect(existsSync(cacheFile)).toBe(true);

    const content = await Bun.file(cacheFile).text();
    const timestamp = Math.trunc(Number(content.trim()));
    expect(isNaN(timestamp)).toBe(false);
    expect(Date.now() - timestamp).toBeLessThan(5_000);
  });

  test("rewrites cache file when cache is stale", async () => {
    const cacheFile = join(tempDir, ".archgate", "last-update-check");
    const staleTimestamp = Date.now() - 25 * 60 * 60 * 1000;
    await Bun.write(cacheFile, String(staleTimestamp));
    const mockFetch = mock(async () => ({
      ok: true,
      json: async () => ({ tag_name: "v0.3.0" }),
    }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).toContain("0.3.0");
    expect(mockFetch).toHaveBeenCalled();

    const content = await Bun.file(cacheFile).text();
    const newTimestamp = Math.trunc(Number(content.trim()));
    expect(newTimestamp).toBeGreaterThan(staleTimestamp);
    expect(Date.now() - newTimestamp).toBeLessThan(5_000);
  });

  test("returns null when semver.order returns null for unparseable version", async () => {
    const mockFetch = mock(async () => ({
      ok: true,
      json: async () => ({ tag_name: "v0.2.0" }),
    }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await checkForUpdatesIfNeeded("not-a-version");
    expect(result).toBeNull();
  });

  test("returns null when an error is thrown during execution", async () => {
    Bun.write = () => {
      throw new Error("simulated disk write failure");
    };
    const mockFetch = mock(async () => ({
      ok: true,
      json: async () => ({ tag_name: "v0.2.0" }),
    }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    // The outer try/catch should swallow the write error and return null
    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).toBeNull();
  });
});

describe("maybeCheckForUpdates", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalIsTTY: boolean | undefined;
  let originalCI: string | undefined;
  let originalArgv: string[];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-maybe-update-test-"));
    originalHome = process.env.HOME;
    originalIsTTY = process.stdout.isTTY;
    originalCI = Bun.env.CI;
    originalArgv = process.argv;
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* temp dir may already be removed */
    }
    // mock.restore() does not undo a direct assignment (ARCH-005).
    globalThis.fetch = originalFetch;
    restoreEnv("HOME", originalHome);
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
    restoreEnv("CI", originalCI);
    process.argv = originalArgv;
    mock.restore();
  });

  test("does not touch the network when gated off", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });
    Bun.env.CI = "1";
    process.argv = ["bun", "cli.ts", "session-context", "claude-code", "list"];
    const fetchSpy = mock(async () => ({ ok: true }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await maybeCheckForUpdates("0.1.0");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("calls through to checkForUpdatesIfNeeded when gated on", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });
    delete Bun.env.CI;
    process.argv = ["bun", "cli.ts", "session-context", "claude-code", "list"];
    process.env.HOME = tempDir;
    const mockFetch = mock(async () => ({
      ok: true,
      json: async () => ({ tag_name: "v0.2.0" }),
    }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await maybeCheckForUpdates("0.1.0");
    expect(result).toContain("0.1.0");
    expect(result).toContain("0.2.0");
  });
});
