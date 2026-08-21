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
  type Mock,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cursorUserDir, opencodeConfigDir } from "../../src/helpers/paths";
import * as platform from "../../src/helpers/platform";
import {
  buildCursorMarketplaceUrl,
  buildMarketplaceUrl,
  buildVscodeMarketplaceUrl,
  installClaudePlugin,
  installCursorPlugin,
  installOpencodePlugin,
  installVscodeExtension,
  isClaudeCliAvailable,
  isCopilotCliAvailable,
  isCursorCliAvailable,
  isOpencodeAvailable,
  isOpencodeCliAvailable,
  isVscodeCliAvailable,
} from "../../src/helpers/plugin-install";
import { restoreEnv, tarballOf } from "../test-utils";

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
  // Deliberately incomplete fake Subprocess: only the fields run() actually
  // reads (stdout/stderr/exited) need real values; the rest are inert filler.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return {
    stdout: new Response(stdout).body!,
    stderr: new Response(stderr).body!,
    exited: Promise.resolve(exitCode),
    pid: 0,
    exitCode: null,
    signalCode: null,
    killed: false,
    // Unused by run(); `never` is filler, not a real stdin implementation.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    stdin: null as never,
    ref: () => {},
    unref: () => {},
    kill: () => {},
    readable: new ReadableStream(),
    [Symbol.asyncDispose]: async () => {},
  } as unknown as ReturnType<typeof Bun.spawn>;
}

/** Replace globalThis.fetch with a mock returning the given status/body. */
function mockFetch(status: number, body: ArrayBuffer | null = null): void {
  // Deliberately minimal fake `fetch`: only status/ok/arrayBuffer are
  // exercised by callers.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  globalThis.fetch = (async () => ({
    status,
    ok: status >= 200 && status < 300,
    arrayBuffer: async () => body ?? new ArrayBuffer(0),
  })) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let spawnSpy: Mock<typeof Bun.spawn>;
let tempHome: string;
let savedHome: string | undefined;
let savedXdg: string | undefined;

/**
 * Per-test spy on resolveCommand so CLI availability checks are deterministic.
 * spyOn (not mock.module) — mock.module on a first-party module is
 * process-global, replaces the WHOLE module for every other test file, and is
 * not undone by mock.restore() (ARCH-005).
 */
let mockResolveCommand: Mock<typeof platform.resolveCommand>;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  mockResolveCommand = spyOn(platform, "resolveCommand").mockImplementation(
    async () => null
  );
  spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => fakeSpawnResult(0));

  // Redirect user-scope paths into a temp dir. The install functions create
  // directories and delete stale archgate files under cursorUserDir() /
  // opencodeConfigDir() / internalPath(), so without this override they wipe
  // the developer's real plugins in ~/.cursor and ~/.config/opencode. All
  // three resolvers read HOME / XDG_CONFIG_HOME at call time.
  tempHome = mkdtempSync(join(tmpdir(), "archgate-plugin-install-"));
  savedHome = Bun.env.HOME;
  savedXdg = Bun.env.XDG_CONFIG_HOME;
  Bun.env.HOME = tempHome;
  delete Bun.env.XDG_CONFIG_HOME;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  spawnSpy.mockRestore();
  mockResolveCommand.mockRestore();
  mock.restore();

  restoreEnv("HOME", savedHome);
  restoreEnv("XDG_CONFIG_HOME", savedXdg);
  rmSync(tempHome, { recursive: true, force: true });
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
      mockResolveCommand.mockImplementation(async () => "claude");
      const result = await isClaudeCliAvailable();
      expect(result).toBe(true);
    });

    test("returns false when resolveCommand returns null", async () => {
      mockResolveCommand.mockImplementation(async () => null);
      const result = await isClaudeCliAvailable();
      expect(result).toBe(false);
    });
  });

  describe("isCursorCliAvailable", () => {
    test("returns true when resolveCommand finds cursor", async () => {
      mockResolveCommand.mockImplementation(async () => "cursor");
      const result = await isCursorCliAvailable();
      expect(result).toBe(true);
    });

    test("returns false when resolveCommand returns null", async () => {
      mockResolveCommand.mockImplementation(async () => null);
      const result = await isCursorCliAvailable();
      expect(result).toBe(false);
    });
  });

  describe("isVscodeCliAvailable", () => {
    test("returns true when resolveCommand finds code", async () => {
      mockResolveCommand.mockImplementation(async () => "code");
      const result = await isVscodeCliAvailable();
      expect(result).toBe(true);
    });

    test("returns false when resolveCommand returns null", async () => {
      mockResolveCommand.mockImplementation(async () => null);
      const result = await isVscodeCliAvailable();
      expect(result).toBe(false);
    });
  });

  describe("isCopilotCliAvailable", () => {
    test("returns true when resolveCommand finds copilot", async () => {
      mockResolveCommand.mockImplementation(async () => "copilot");
      const result = await isCopilotCliAvailable();
      expect(result).toBe(true);
    });

    test("returns false when resolveCommand returns null", async () => {
      mockResolveCommand.mockImplementation(async () => null);
      const result = await isCopilotCliAvailable();
      expect(result).toBe(false);
    });
  });

  describe("isOpencodeCliAvailable", () => {
    test("returns true when resolveCommand finds opencode", async () => {
      mockResolveCommand.mockImplementation(async () => "opencode");
      const result = await isOpencodeCliAvailable();
      expect(result).toBe(true);
    });

    test("returns false when resolveCommand returns null", async () => {
      mockResolveCommand.mockImplementation(async () => null);
      const result = await isOpencodeCliAvailable();
      expect(result).toBe(false);
    });
  });

  describe("isOpencodeAvailable", () => {
    test("returns true when the CLI is on PATH", async () => {
      mockResolveCommand.mockImplementation(async () => "opencode");
      const result = await isOpencodeAvailable();
      expect(result).toBe(true);
    });

    test("returns true when the Desktop app's config dir exists but no CLI is on PATH", async () => {
      // Regression test: the opencode Desktop app is Electron-based and
      // ships no CLI binary at all, so isOpencodeCliAvailable() alone would
      // never detect it. Both distributions read/write the same user-scope
      // config directory, so its presence is a reliable signal on its own.
      mockResolveCommand.mockImplementation(async () => null);
      mkdirSync(opencodeConfigDir(), { recursive: true });

      const result = await isOpencodeAvailable();
      expect(result).toBe(true);
    });

    test("returns false when neither the CLI nor the config dir is present", async () => {
      mockResolveCommand.mockImplementation(async () => null);
      const result = await isOpencodeAvailable();
      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // installClaudePlugin
  // -----------------------------------------------------------------------

  describe("installClaudePlugin", () => {
    test("runs marketplace add and plugin install on success", async () => {
      mockResolveCommand.mockImplementation(async () => "claude");
      spawnSpy.mockImplementation(() => fakeSpawnResult(0));

      await installClaudePlugin();

      expect(spawnSpy).toHaveBeenCalledTimes(2);
      const firstCall = spawnSpy.mock.calls[0][0];
      expect(firstCall).toContain("marketplace");
      expect(firstCall).toContain("add");
      const secondCall = spawnSpy.mock.calls[1][0];
      expect(secondCall).toContain("install");
      expect(secondCall).toContain("archgate@archgate");
    });

    test("throws when marketplace add fails", async () => {
      mockResolveCommand.mockImplementation(async () => "claude");
      spawnSpy.mockImplementation(() => fakeSpawnResult(1));

      expect(installClaudePlugin()).rejects.toThrow("marketplace add failed");
    });

    test("throws when plugin install fails", async () => {
      mockResolveCommand.mockImplementation(async () => "claude");
      let callCount = 0;
      spawnSpy.mockImplementation(() => {
        callCount++;
        // First call (marketplace add) succeeds, second (install) fails
        return fakeSpawnResult(callCount === 1 ? 0 : 1);
      });

      expect(installClaudePlugin()).rejects.toThrow("plugin install failed");
    });

    test("falls back to 'claude' when resolveCommand returns null", async () => {
      mockResolveCommand.mockImplementation(async () => null);
      spawnSpy.mockImplementation(() => fakeSpawnResult(0));

      await installClaudePlugin();

      const firstCall = spawnSpy.mock.calls[0][0];
      expect(firstCall[0]).toBe("claude");
    });
  });

  // -----------------------------------------------------------------------
  // installVscodeExtension
  // -----------------------------------------------------------------------

  describe("installVscodeExtension", () => {
    test("downloads vsix and installs via code CLI on success", async () => {
      mockResolveCommand.mockImplementation(async () => "code");
      const vsixContent = new ArrayBuffer(128);
      mockFetch(200, vsixContent);
      spawnSpy.mockImplementation(() => fakeSpawnResult(0));

      await installVscodeExtension("test-token");

      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const callArgs = spawnSpy.mock.calls[0][0];
      expect(callArgs).toContain("--install-extension");
    });

    test("throws with vsix path when code CLI fails", async () => {
      mockResolveCommand.mockImplementation(async () => "code");
      mockFetch(200, new ArrayBuffer(64));
      spawnSpy.mockImplementation(() => fakeSpawnResult(1));

      expect(installVscodeExtension("test-token")).rejects.toThrow(
        "install-extension failed"
      );
    });

    test("throws re-login message on 401 download", async () => {
      mockResolveCommand.mockImplementation(async () => "code");
      mockFetch(401);

      expect(installVscodeExtension("expired-token")).rejects.toThrow(
        "expired"
      );
    });

    test("throws generic error on non-401 HTTP failure", async () => {
      mockResolveCommand.mockImplementation(async () => "code");
      mockFetch(500);

      expect(installVscodeExtension("test-token")).rejects.toThrow(
        "Download failed (HTTP 500)"
      );
    });
  });

  // -----------------------------------------------------------------------
  // installOpencodePlugin
  // -----------------------------------------------------------------------

  describe("installOpencodePlugin", () => {
    test("downloads the tarball and writes its entries into the config dir", async () => {
      mockFetch(
        200,
        await tarballOf({
          "agents/archgate-developer.md": "agent",
          "skills/archgate-adr-author/SKILL.md": "skill",
        })
      );

      await installOpencodePlugin("test-token");

      const base = opencodeConfigDir();
      expect(
        await Bun.file(join(base, "agents", "archgate-developer.md")).text()
      ).toBe("agent");
      expect(
        await Bun.file(
          join(base, "skills", "archgate-adr-author", "SKILL.md")
        ).text()
      ).toBe("skill");
      // Nothing is spawned any more — extraction is in-process.
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    test("throws when the downloaded bundle is not a readable archive", async () => {
      mockFetch(200, new ArrayBuffer(64));

      expect(installOpencodePlugin("test-token")).rejects.toThrow(
        "Failed to extract opencode components"
      );
    });

    test("throws re-login message on 401 download", async () => {
      mockFetch(401);

      expect(installOpencodePlugin("expired-token")).rejects.toThrow("expired");
    });

    test("throws generic error on non-401 HTTP failure", async () => {
      mockFetch(503);

      expect(installOpencodePlugin("test-token")).rejects.toThrow(
        "Download failed (HTTP 503)"
      );
    });
  });

  // -----------------------------------------------------------------------
  // installCursorPlugin
  // -----------------------------------------------------------------------

  describe("installCursorPlugin", () => {
    test("downloads the tarball and writes its entries into the cursor dir", async () => {
      mockFetch(
        200,
        await tarballOf({ "agents/archgate-developer.md": "agent" })
      );

      await installCursorPlugin("test-token");

      expect(
        await Bun.file(
          join(cursorUserDir(), "agents", "archgate-developer.md")
        ).text()
      ).toBe("agent");
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    test("throws when the downloaded bundle is not a readable archive", async () => {
      mockFetch(200, new ArrayBuffer(64));

      expect(installCursorPlugin("test-token")).rejects.toThrow(
        "Failed to extract Cursor components"
      );
    });

    // The bundle is remote input landing in a live `~/.cursor/`. Containment
    // keeps it under that directory; the allowlist decides where within.
    test("writes only agents, skills and hooks.json", async () => {
      mockFetch(
        200,
        await tarballOf({
          "agents/archgate-developer.md": "agent",
          "skills/archgate-adr-author/SKILL.md": "skill",
          "hooks.json": "[]",
          "settings.json": '{"pwned":true}',
          "stray.md": "stray",
        })
      );

      await installCursorPlugin("test-token");

      const base = cursorUserDir();
      expect(
        await Bun.file(join(base, "agents", "archgate-developer.md")).exists()
      ).toBe(true);
      expect(await Bun.file(join(base, "hooks.json")).exists()).toBe(true);
      expect(await Bun.file(join(base, "settings.json")).exists()).toBe(false);
      expect(await Bun.file(join(base, "stray.md")).exists()).toBe(false);
    });

    // Containment normalizes the entry to `escaped.md` at the root of the
    // cursor dir, where the allowlist then drops it — so it lands nowhere.
    test("drops a traversing entry instead of writing it anywhere", async () => {
      mockFetch(200, await tarballOf({ "../escaped.md": "pwned" }));

      await installCursorPlugin("test-token");

      expect(await Bun.file(join(cursorUserDir(), "escaped.md")).exists()).toBe(
        false
      );
      expect(await Bun.file(join(tempHome, "escaped.md")).exists()).toBe(false);
    });

    test("throws re-login message on 401 download", async () => {
      mockFetch(401);

      expect(installCursorPlugin("expired-token")).rejects.toThrow("expired");
    });

    test("throws generic error on non-401 HTTP failure", async () => {
      mockFetch(503);

      expect(installCursorPlugin("test-token")).rejects.toThrow(
        "Download failed (HTTP 503)"
      );
    });
  });
});
