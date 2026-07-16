// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  maybeCheckForUpdates,
  shouldPerformUpdateCheck,
} from "../../src/helpers/update-check";
import { restoreEnv } from "../test-utils";

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
  const originalBunWrite = Bun.write;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-update-check-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* temp dir may already be removed */
    }
    restoreEnv("HOME", originalHome);
    Bun.write = originalBunWrite;
    mock.restore();
  });

  test("returns null when fetch fails", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("network error"))) as unknown as typeof fetch;

    // Import after mock setup to get fresh module in test context
    const { checkForUpdatesIfNeeded } = await import(
      `../../src/helpers/update-check?t=${Date.now()}`
    );

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).toBeNull();
  });

  test("returns null when already up-to-date", async () => {
    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v0.1.0" }),
      })
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const { checkForUpdatesIfNeeded } = await import(
      `../../src/helpers/update-check?t=${Date.now()}`
    );

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).toBeNull();
  });

  test("returns notice string when update is available", async () => {
    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v0.2.0" }),
      })
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const { checkForUpdatesIfNeeded } = await import(
      `../../src/helpers/update-check?t=${Date.now()}`
    );

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).not.toBeNull();
    expect(result).toContain("0.1.0");
    expect(result).toContain("0.2.0");
    expect(result).toContain("archgate upgrade");
  });

  test("returns null when GitHub API returns non-ok response", async () => {
    const mockFetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        json: () => Promise.resolve({}),
      })
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const { checkForUpdatesIfNeeded } = await import(
      `../../src/helpers/update-check?t=${Date.now()}`
    );

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).toBeNull();
  });

  test("returns null when tag_name is missing from response", async () => {
    const mockFetch = mock(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const { checkForUpdatesIfNeeded } = await import(
      `../../src/helpers/update-check?t=${Date.now()}`
    );

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).toBeNull();
  });

  test("skips check when cache is recent", async () => {
    // Write a fresh cache timestamp
    const cacheDir = join(tempDir, ".archgate");
    await Bun.write(join(cacheDir, "last-update-check"), String(Date.now()));

    const fetchSpy = mock(() => Promise.resolve({ ok: true }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { checkForUpdatesIfNeeded } = await import(
      `../../src/helpers/update-check?t=${Date.now()}`
    );

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("creates cache file when no cache exists", async () => {
    const cacheFile = join(tempDir, ".archgate", "last-update-check");
    expect(existsSync(cacheFile)).toBe(false);

    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v0.2.0" }),
      })
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const { checkForUpdatesIfNeeded } = await import(
      `../../src/helpers/update-check?t=${Date.now()}`
    );

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).toContain("0.2.0");
    expect(existsSync(cacheFile)).toBe(true);

    // Cache file should contain a numeric timestamp
    const content = await Bun.file(cacheFile).text();
    const timestamp = Math.trunc(Number(content.trim()));
    expect(isNaN(timestamp)).toBe(false);
    // Timestamp should be within the last 5 seconds
    expect(Date.now() - timestamp).toBeLessThan(5_000);
  });

  test("rewrites cache file when cache is stale", async () => {
    const cacheFile = join(tempDir, ".archgate", "last-update-check");
    // Write a stale timestamp (25 hours ago)
    const staleTimestamp = Date.now() - 25 * 60 * 60 * 1000;
    await Bun.write(cacheFile, String(staleTimestamp));

    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v0.3.0" }),
      })
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const { checkForUpdatesIfNeeded } = await import(
      `../../src/helpers/update-check?t=${Date.now()}`
    );

    const result = await checkForUpdatesIfNeeded("0.1.0");
    expect(result).toContain("0.3.0");
    expect(mockFetch).toHaveBeenCalled();

    // Cache file should have been rewritten with a fresh timestamp
    const content = await Bun.file(cacheFile).text();
    const newTimestamp = Math.trunc(Number(content.trim()));
    expect(newTimestamp).toBeGreaterThan(staleTimestamp);
    expect(Date.now() - newTimestamp).toBeLessThan(5_000);
  });

  test("returns null when semver.order returns null for unparseable version", async () => {
    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v0.2.0" }),
      })
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const { checkForUpdatesIfNeeded } = await import(
      `../../src/helpers/update-check?t=${Date.now()}`
    );

    // Pass a version string that semver cannot parse
    const result = await checkForUpdatesIfNeeded("not-a-version");
    expect(result).toBeNull();
  });

  test("returns null when an error is thrown during execution", async () => {
    // Simulate a disk write failure by making Bun.write throw
    Bun.write = (() => {
      throw new Error("simulated disk write failure");
    }) as unknown as typeof Bun.write;

    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v0.2.0" }),
      })
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const { checkForUpdatesIfNeeded } = await import(
      `../../src/helpers/update-check?t=${Date.now()}`
    );

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

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-maybe-update-test-"));
    originalHome = process.env.HOME;
    originalIsTTY = process.stdout.isTTY;
    originalCI = Bun.env.CI;
    originalArgv = process.argv;
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* temp dir may already be removed */
    }
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

    const fetchSpy = mock(() => Promise.resolve({ ok: true }));
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

    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tag_name: "v0.2.0" }),
      })
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const { maybeCheckForUpdates: freshMaybeCheckForUpdates } = await import(
      `../../src/helpers/update-check?t=${Date.now()}`
    );

    const result = await freshMaybeCheckForUpdates("0.1.0");
    expect(result).toContain("0.1.0");
    expect(result).toContain("0.2.0");
  });
});
