import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("checkForUpdatesIfNeeded", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-update-check-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
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
        json: () => Promise.resolve({ version: "0.1.0" }),
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
        json: () => Promise.resolve({ version: "0.2.0" }),
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

  test("returns null when npm registry returns non-ok response", async () => {
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

  test("returns null when version is missing from response", async () => {
    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
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
});
