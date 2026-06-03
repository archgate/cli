// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

// ---------------------------------------------------------------------------
// Module mocks — declared before imports that use them.
// ---------------------------------------------------------------------------

/** Mock resolveCommand so CLI availability checks are deterministic. */
const mockResolveCommand = mock<(name: string) => Promise<string | null>>(() =>
  Promise.resolve(null)
);
mock.module("../../src/helpers/platform", () => ({
  resolveCommand: mockResolveCommand,
}));

// ---------------------------------------------------------------------------
// Imports under test — loaded AFTER mocks are registered.
// ---------------------------------------------------------------------------

import {
  buildCursorMarketplaceUrl,
  buildMarketplaceUrl,
  buildVscodeMarketplaceUrl,
  installClaudePlugin,
  installCopilotPlugin,
  installCursorPlugin,
  installOpencodePlugin,
  installVscodeExtension,
  isClaudeCliAvailable,
  isCopilotCliAvailable,
  isCursorCliAvailable,
  isOpencodeCliAvailable,
  isVscodeCliAvailable,
} from "../../src/helpers/plugin-install";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Save and restore globalThis.fetch around tests that mock it. */
let originalFetch: typeof globalThis.fetch;

/**
 * Create a fake Bun.spawn return value. The `run()` helper inside
 * plugin-install reads stdout/stderr via `new Response(proc.stdout).text()`
 * and waits for `proc.exited`.
 */
function fakeSpawnResult(
  exitCode: number,
  stdout = "",
  stderr = ""
): ReturnType<typeof Bun.spawn> {
  return {
    stdout: new Response(stdout).body!,
    stderr: new Response(stderr).body!,
    exited: Promise.resolve(exitCode),
    pid: 0,
    exitCode: null,
    signalCode: null,
    killed: false,
    stdin: null as never,
    ref: () => {},
    unref: () => {},
    kill: () => {},
    readable: new ReadableStream(),
    [Symbol.asyncDispose]: () => Promise.resolve(),
  } as unknown as ReturnType<typeof Bun.spawn>;
}

/** Replace globalThis.fetch with a mock returning the given status/body. */
function mockFetch(status: number, body: ArrayBuffer | null = null): void {
  globalThis.fetch = (() =>
    Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      arrayBuffer: () => Promise.resolve(body ?? new ArrayBuffer(0)),
    })) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let spawnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  mockResolveCommand.mockReset();
  mockResolveCommand.mockImplementation(() => Promise.resolve(null));
  spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => fakeSpawnResult(0));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  spawnSpy.mockRestore();
  mock.restore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("plugin-install", () => {
  // -----------------------------------------------------------------------
  // URL builders
  // -----------------------------------------------------------------------

  describe("buildMarketplaceUrl", () => {
    test("returns bare URL without embedded credentials", () => {
      const url = buildMarketplaceUrl();
      expect(url).toBe("https://plugins.archgate.dev/archgate.git");
    });

    test("does not contain @ (no embedded credentials)", () => {
      const url = buildMarketplaceUrl();
      expect(url).not.toContain("@");
    });
  });

  describe("buildVscodeMarketplaceUrl", () => {
    test("returns bare URL pointing to archgate/vscode.git", () => {
      const url = buildVscodeMarketplaceUrl();
      expect(url).toBe("https://plugins.archgate.dev/archgate/vscode.git");
    });

    test("does not contain @ (no embedded credentials)", () => {
      const url = buildVscodeMarketplaceUrl();
      expect(url).not.toContain("@");
    });

    test("uses archgate/vscode.git path (not archgate.git)", () => {
      const vscodeUrl = buildVscodeMarketplaceUrl();
      const claudeUrl = buildMarketplaceUrl();
      expect(vscodeUrl).toContain("archgate/vscode.git");
      expect(claudeUrl).not.toContain("archgate/vscode.git");
      expect(claudeUrl).toContain("archgate.git");
    });
  });

  describe("buildCursorMarketplaceUrl", () => {
    test("returns bare URL pointing to archgate/cursor.git", () => {
      const url = buildCursorMarketplaceUrl();
      expect(url).toBe("https://plugins.archgate.dev/archgate/cursor.git");
    });

    test("does not contain @ (no embedded credentials)", () => {
      const url = buildCursorMarketplaceUrl();
      expect(url).not.toContain("@");
    });

    test("differs from the base marketplace URL and vscode URL", () => {
      const cursorUrl = buildCursorMarketplaceUrl();
      const claudeUrl = buildMarketplaceUrl();
      const vscodeUrl = buildVscodeMarketplaceUrl();
      expect(cursorUrl).not.toBe(claudeUrl);
      expect(cursorUrl).not.toBe(vscodeUrl);
    });
  });

  // -----------------------------------------------------------------------
  // CLI availability checks
  // -----------------------------------------------------------------------

  describe("isClaudeCliAvailable", () => {
    test("returns true when resolveCommand finds claude", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("claude"));
      const result = await isClaudeCliAvailable();
      expect(result).toBe(true);
    });

    test("returns false when resolveCommand returns null", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve(null));
      const result = await isClaudeCliAvailable();
      expect(result).toBe(false);
    });
  });

  describe("isCursorCliAvailable", () => {
    test("returns true when resolveCommand finds cursor", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("cursor"));
      const result = await isCursorCliAvailable();
      expect(result).toBe(true);
    });

    test("returns false when resolveCommand returns null", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve(null));
      const result = await isCursorCliAvailable();
      expect(result).toBe(false);
    });
  });

  describe("isVscodeCliAvailable", () => {
    test("returns true when resolveCommand finds code", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("code"));
      const result = await isVscodeCliAvailable();
      expect(result).toBe(true);
    });

    test("returns false when resolveCommand returns null", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve(null));
      const result = await isVscodeCliAvailable();
      expect(result).toBe(false);
    });
  });

  describe("isCopilotCliAvailable", () => {
    test("returns true when resolveCommand finds copilot", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("copilot"));
      const result = await isCopilotCliAvailable();
      expect(result).toBe(true);
    });

    test("returns false when resolveCommand returns null", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve(null));
      const result = await isCopilotCliAvailable();
      expect(result).toBe(false);
    });
  });

  describe("isOpencodeCliAvailable", () => {
    test("returns true when resolveCommand finds opencode", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("opencode"));
      const result = await isOpencodeCliAvailable();
      expect(result).toBe(true);
    });

    test("returns false when resolveCommand returns null", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve(null));
      const result = await isOpencodeCliAvailable();
      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // installClaudePlugin
  // -----------------------------------------------------------------------

  describe("installClaudePlugin", () => {
    test("runs marketplace add and plugin install on success", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("claude"));
      spawnSpy.mockImplementation(() => fakeSpawnResult(0));

      await installClaudePlugin();

      // Two spawn calls: marketplace add + plugin install
      expect(spawnSpy).toHaveBeenCalledTimes(2);
      const firstCall = spawnSpy.mock.calls[0][0] as string[];
      expect(firstCall).toContain("marketplace");
      expect(firstCall).toContain("add");
      const secondCall = spawnSpy.mock.calls[1][0] as string[];
      expect(secondCall).toContain("install");
      expect(secondCall).toContain("archgate@archgate");
    });

    test("throws when marketplace add fails", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("claude"));
      spawnSpy.mockImplementation(() => fakeSpawnResult(1));

      await expect(installClaudePlugin()).rejects.toThrow(
        "marketplace add failed"
      );
    });

    test("throws when plugin install fails", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("claude"));
      let callCount = 0;
      spawnSpy.mockImplementation(() => {
        callCount++;
        // First call (marketplace add) succeeds, second (install) fails
        return fakeSpawnResult(callCount === 1 ? 0 : 1);
      });

      await expect(installClaudePlugin()).rejects.toThrow(
        "plugin install failed"
      );
    });

    test("falls back to 'claude' when resolveCommand returns null", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve(null));
      spawnSpy.mockImplementation(() => fakeSpawnResult(0));

      await installClaudePlugin();

      const firstCall = spawnSpy.mock.calls[0][0] as string[];
      expect(firstCall[0]).toBe("claude");
    });
  });

  // -----------------------------------------------------------------------
  // installCopilotPlugin
  // -----------------------------------------------------------------------

  describe("installCopilotPlugin", () => {
    test("runs marketplace add and plugin install on success", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("copilot"));
      spawnSpy.mockImplementation(() => fakeSpawnResult(0));

      await installCopilotPlugin();

      expect(spawnSpy).toHaveBeenCalledTimes(2);
      const firstCall = spawnSpy.mock.calls[0][0] as string[];
      expect(firstCall).toContain("marketplace");
      expect(firstCall).toContain("add");
      const secondCall = spawnSpy.mock.calls[1][0] as string[];
      expect(secondCall).toContain("install");
      expect(secondCall).toContain("archgate@archgate");
    });

    test("throws when marketplace add fails with non-already-registered error", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("copilot"));
      spawnSpy.mockImplementation(() => fakeSpawnResult(1, "", "some error"));

      await expect(installCopilotPlugin()).rejects.toThrow(
        "marketplace add failed"
      );
    });

    test("skips marketplace add error when 'already registered'", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("copilot"));
      let callCount = 0;
      spawnSpy.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // marketplace add fails with "already registered"
          return fakeSpawnResult(1, "already registered", "");
        }
        // plugin install succeeds
        return fakeSpawnResult(0);
      });

      // Should not throw — "already registered" is tolerated
      await installCopilotPlugin();
      expect(spawnSpy).toHaveBeenCalledTimes(2);
    });

    test("throws when plugin install fails", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("copilot"));
      let callCount = 0;
      spawnSpy.mockImplementation(() => {
        callCount++;
        return fakeSpawnResult(callCount === 1 ? 0 : 1);
      });

      await expect(installCopilotPlugin()).rejects.toThrow(
        "plugin install failed"
      );
    });
  });

  // -----------------------------------------------------------------------
  // installVscodeExtension
  // -----------------------------------------------------------------------

  describe("installVscodeExtension", () => {
    test("downloads vsix and installs via code CLI on success", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("code"));
      const vsixContent = new ArrayBuffer(128);
      mockFetch(200, vsixContent);
      spawnSpy.mockImplementation(() => fakeSpawnResult(0));

      await installVscodeExtension("test-token");

      // fetch was called for the download
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const callArgs = spawnSpy.mock.calls[0][0] as string[];
      expect(callArgs).toContain("--install-extension");
    });

    test("throws with vsix path when code CLI fails", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("code"));
      mockFetch(200, new ArrayBuffer(64));
      spawnSpy.mockImplementation(() => fakeSpawnResult(1));

      await expect(installVscodeExtension("test-token")).rejects.toThrow(
        "install-extension failed"
      );
    });

    test("throws re-login message on 401 download", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("code"));
      mockFetch(401);

      await expect(installVscodeExtension("expired-token")).rejects.toThrow(
        "expired"
      );
    });

    test("throws generic error on non-401 HTTP failure", async () => {
      mockResolveCommand.mockImplementation(() => Promise.resolve("code"));
      mockFetch(500);

      await expect(installVscodeExtension("test-token")).rejects.toThrow(
        "Download failed (HTTP 500)"
      );
    });
  });

  // -----------------------------------------------------------------------
  // installOpencodePlugin
  // -----------------------------------------------------------------------

  describe("installOpencodePlugin", () => {
    test("downloads tarball and extracts via tar on success", async () => {
      const tarContent = new ArrayBuffer(256);
      mockFetch(200, tarContent);
      spawnSpy.mockImplementation(() => fakeSpawnResult(0));

      await installOpencodePlugin("test-token");

      // One spawn call for tar extraction
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const callArgs = spawnSpy.mock.calls[0][0] as string[];
      expect(callArgs[0]).toBe("tar");
      expect(callArgs).toContain("-xzf");
    });

    test("throws when tar extraction fails", async () => {
      mockFetch(200, new ArrayBuffer(64));
      spawnSpy.mockImplementation(() => fakeSpawnResult(2));

      await expect(installOpencodePlugin("test-token")).rejects.toThrow(
        "tar -xzf failed"
      );
    });

    test("throws re-login message on 401 download", async () => {
      mockFetch(401);

      await expect(installOpencodePlugin("expired-token")).rejects.toThrow(
        "expired"
      );
    });

    test("throws generic error on non-401 HTTP failure", async () => {
      mockFetch(503);

      await expect(installOpencodePlugin("test-token")).rejects.toThrow(
        "Download failed (HTTP 503)"
      );
    });
  });

  // -----------------------------------------------------------------------
  // installCursorPlugin
  // -----------------------------------------------------------------------

  describe("installCursorPlugin", () => {
    test("downloads tarball and extracts via tar on success", async () => {
      const tarContent = new ArrayBuffer(256);
      mockFetch(200, tarContent);
      spawnSpy.mockImplementation(() => fakeSpawnResult(0));

      await installCursorPlugin("test-token");

      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const callArgs = spawnSpy.mock.calls[0][0] as string[];
      expect(callArgs[0]).toBe("tar");
      expect(callArgs).toContain("-xzf");
    });

    test("throws when tar extraction fails", async () => {
      mockFetch(200, new ArrayBuffer(64));
      spawnSpy.mockImplementation(() => fakeSpawnResult(2));

      await expect(installCursorPlugin("test-token")).rejects.toThrow(
        "tar -xzf failed"
      );
    });

    test("throws re-login message on 401 download", async () => {
      mockFetch(401);

      await expect(installCursorPlugin("expired-token")).rejects.toThrow(
        "expired"
      );
    });

    test("throws generic error on non-401 HTTP failure", async () => {
      mockFetch(503);

      await expect(installCursorPlugin("test-token")).rejects.toThrow(
        "Download failed (HTTP 503)"
      );
    });
  });
});
