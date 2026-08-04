// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * GitHub Copilot install flow (`isCopilotAvailable` + `installCopilotPlugin`).
 * Sibling of plugin-install.test.ts — shares its harness pattern (spawn spy,
 * resolveCommand spy, temp HOME) but covers only the Copilot-specific flow.
 */
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
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { copilotConfigDir } from "../../src/helpers/paths";
import * as platform from "../../src/helpers/platform";
import {
  buildVscodeMarketplaceUrl,
  installCopilotPlugin,
  isCopilotAvailable,
} from "../../src/helpers/plugin-install";
import { restoreEnv } from "../test-utils";

/**
 * Create a fake Bun.spawn return value — same shape as the fake in
 * plugin-install.test.ts: only stdout/stderr/exited are read by run().
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

let spawnSpy: Mock<typeof Bun.spawn>;
let tempHome: string;
let savedHome: string | undefined;
let mockResolveCommand: Mock<typeof platform.resolveCommand>;

beforeEach(() => {
  mockResolveCommand = spyOn(platform, "resolveCommand").mockImplementation(
    async () => null
  );
  spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => fakeSpawnResult(0));

  // Redirect ~/.copilot into a temp dir so tests never touch the
  // developer's real Copilot settings. copilotConfigDir() reads HOME at
  // call time.
  tempHome = mkdtempSync(join(tmpdir(), "archgate-copilot-install-"));
  savedHome = Bun.env.HOME;
  Bun.env.HOME = tempHome;
});

afterEach(() => {
  spawnSpy.mockRestore();
  mockResolveCommand.mockRestore();
  mock.restore();

  restoreEnv("HOME", savedHome);
  rmSync(tempHome, { recursive: true, force: true });
});

/** Read the settings file written into the temp ~/.copilot. */
async function readWrittenSettings(): Promise<Record<string, unknown>> {
  const raw: unknown = await Bun.file(
    join(copilotConfigDir(), "settings.json")
  ).json();
  // Test-only narrowing of a file this suite just wrote as a JSON object.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return raw as Record<string, unknown>;
}

describe("isCopilotAvailable", () => {
  test("returns true when the CLI is on PATH", async () => {
    mockResolveCommand.mockImplementation(async () => "copilot");
    const result = await isCopilotAvailable();
    expect(result).toBe(true);
  });

  test("returns true when the desktop app's config dir exists but no CLI is on PATH", async () => {
    // The desktop app ships no CLI binary, so the PATH probe alone would
    // never detect it. Both distributions share ~/.copilot, so its
    // presence is a reliable signal on its own.
    mockResolveCommand.mockImplementation(async () => null);
    mkdirSync(copilotConfigDir(), { recursive: true });

    const result = await isCopilotAvailable();
    expect(result).toBe(true);
  });

  test("returns false when neither the CLI nor the config dir is present", async () => {
    mockResolveCommand.mockImplementation(async () => null);
    const result = await isCopilotAvailable();
    expect(result).toBe(false);
  });
});

describe("installCopilotPlugin", () => {
  test("cli mode: declares settings then runs plugin install (no marketplace add)", async () => {
    mockResolveCommand.mockImplementation(async () => "copilot");
    mkdirSync(copilotConfigDir(), { recursive: true });

    const result = await installCopilotPlugin();

    expect(result).toEqual({ mode: "cli" });
    // The marketplace is registered declaratively via settings.json, so the
    // only subprocess is the install itself.
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const argv = spawnSpy.mock.calls[0][0];
    expect(argv).toContain("install");
    expect(argv).toContain("archgate@archgate");
    expect(argv).not.toContain("marketplace");

    const settings = await readWrittenSettings();
    expect(settings.extraKnownMarketplaces).toEqual({
      archgate: { source: { source: "git", url: buildVscodeMarketplaceUrl() } },
    });
    expect(settings.enabledPlugins).toEqual({ "archgate@archgate": true });
  });

  test("declarative mode: writes settings and spawns nothing when the CLI is absent", async () => {
    mockResolveCommand.mockImplementation(async () => null);
    mkdirSync(copilotConfigDir(), { recursive: true });

    const result = await installCopilotPlugin();

    expect(result).toEqual({ mode: "declarative" });
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(existsSync(join(copilotConfigDir(), "settings.json"))).toBe(true);
  });

  test("overwrites a stale archgate marketplace URL while preserving other entries", async () => {
    mockResolveCommand.mockImplementation(async () => null);
    mkdirSync(copilotConfigDir(), { recursive: true });
    await Bun.write(
      join(copilotConfigDir(), "settings.json"),
      JSON.stringify({
        extraKnownMarketplaces: {
          archgate: {
            source: { source: "git", url: "https://example.com/dead.git" },
          },
          other: { source: { source: "github", repo: "acme/plugins" } },
        },
        enabledPlugins: { "foo@other": true },
        theme: "dark",
      })
    );

    await installCopilotPlugin();

    const settings = await readWrittenSettings();
    expect(settings.extraKnownMarketplaces).toEqual({
      archgate: { source: { source: "git", url: buildVscodeMarketplaceUrl() } },
      other: { source: { source: "github", repo: "acme/plugins" } },
    });
    expect(settings.enabledPlugins).toEqual({
      "foo@other": true,
      "archgate@archgate": true,
    });
    expect(settings.theme).toBe("dark");
  });

  test("throws when the CLI install fails", async () => {
    mockResolveCommand.mockImplementation(async () => "copilot");
    mkdirSync(copilotConfigDir(), { recursive: true });
    spawnSpy.mockImplementation(() => fakeSpawnResult(1, "", "boom"));

    expect(installCopilotPlugin()).rejects.toThrow("plugin install failed");
  });
});
